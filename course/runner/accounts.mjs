// Who may sign in, and as whom. A learner signs in with their email and a 6-digit code sent to
// it; the allowlist (exact emails and domain rules, each in a cohort) decides whether they may
// use the course. A company email that isn't listed may ask (an access request), once it has
// shown it's theirs with a code; personal email addresses are asked for a company one, unless
// an admin listed them exactly. ADMIN_EMAILS are always allowed, and are the admins.
import { e2eSignInCode, hashSignInCode, newLearnerId, newSignInCode } from "./auth.mjs";
import { transaction } from "./db.mjs";
import { RateLimiter } from "./ratelimit.mjs";

export const ROLES = ["Developer", "Architect", "Engineering manager", "Platform/SRE", "Data/ML", "Other"];
export const ON_DEMAND = "On-demand";
export const DEFAULT_ALLOWANCE_MINUTES = 8 * 60;

const CODE_TTL_MS = 10 * 60_000;
const CODE_TRIES = 5;
const EMAIL = /^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const E2E_EMAIL = /^e2e\+[a-z0-9._-]+@temporalquest\.dev$/;

// Free-mail providers: an address on one is a person's, not their company's.
export const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.jp", "ymail.com",
  "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me",
  "aol.com", "gmx.com", "gmx.de", "gmx.net", "web.de",
  "mail.com", "mail.ru", "yandex.com", "yandex.ru",
  "qq.com", "163.com", "126.com", "foxmail.com", "sina.com",
  "zoho.com", "zohomail.com", "fastmail.com", "tutanota.com", "hey.com",
]);

export function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

export const domainOf = (email) => email.slice(email.lastIndexOf("@") + 1);
export const isPersonalEmail = (email) => PERSONAL_DOMAINS.has(domainOf(email));

// "mail.acme.co.uk" → "Acme".
export function companyOf(email) {
  const parts = domainOf(email).split(".");
  const tld = parts.at(-1);
  const second = parts.at(-2) ?? "";
  const name = parts.length >= 3 && tld.length === 2 && second.length <= 3 ? parts.at(-3) : second;
  return name ? name[0].toUpperCase() + name.slice(1) : null;
}

// One line of a pasted allowlist: an email, or a domain rule ("@acme.com" or "acme.com").
export function parseEntry(line) {
  const value = String(line ?? "").trim().toLowerCase().replace(/^[<"']+|[>"',;]+$/g, "");
  if (!value) return null;
  if (value.includes("@") && !value.startsWith("@")) {
    const email = normalizeEmail(value);
    return email ? { kind: "email", value: email } : { error: value };
  }
  const domain = value.replace(/^@/, "");
  return DOMAIN.test(domain) ? { kind: "domain", value: domain } : { error: value };
}

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export class Accounts {
  constructor(db, { secret, adminEmails = [], consoleSignIn = () => false, e2eKey = "", now = () => Date.now(), record = () => {} } = {}) {
    this.db = db;
    this.secret = secret;
    this.adminEmails = new Set(adminEmails);
    this.consoleSignIn = consoleSignIn;
    this.e2eKey = e2eKey;
    this.now = now;
    this.record = record; // (userId, type, moduleId, data): the activity log (activity.mjs)
    this.emailSends = new RateLimiter({ perKey: 3, global: 10_000, windowMs: 15 * 60_000, now });
    this.ipSends = new RateLimiter({ perKey: 10, global: 10_000, windowMs: 15 * 60_000, now });
    // Wrong codes per email, whichever code they were for: a new code doesn't buy more tries.
    this.wrongCodes = new RateLimiter({ perKey: 10, global: 1_000_000, windowMs: 15 * 60_000, now });
    this.onDemand = this.#ensureOnDemand();
  }

  #ensureOnDemand() {
    const found = this.db.prepare("SELECT * FROM cohorts WHERE builtin = 1").get();
    if (found) return found.id;
    return Number(
      this.db
        .prepare("INSERT INTO cohorts (name, allowance_minutes, builtin, created_at) VALUES (?, ?, 1, ?)")
        .run(ON_DEMAND, DEFAULT_ALLOWANCE_MINUTES, this.now()).lastInsertRowid,
    );
  }

  isAdmin(email) {
    return this.adminEmails.has(email);
  }

  // --- The allowlist ------------------------------------------------------------------------

  cohortActive(cohort) {
    return !cohort.ends_at || cohort.ends_at > this.now();
  }

  // The entry that lets an email in, exact before domain, with its cohort: { entry, cohort } or
  // null. An entry whose cohort has ended is returned with `ended`.
  entryFor(email) {
    const find = (kind, value) =>
      this.db
        .prepare("SELECT a.*, c.name AS cohort_name FROM allowlist a JOIN cohorts c ON c.id = a.cohort_id WHERE a.kind = ? AND a.value = ?")
        .get(kind, value);
    const entry = find("email", email) ?? find("domain", domainOf(email));
    if (!entry) return null;
    const cohort = this.db.prepare("SELECT * FROM cohorts WHERE id = ?").get(entry.cohort_id);
    return { entry, cohort, ended: !this.cohortActive(cohort) };
  }

  // Whether an email may use the course, and in which cohort: { allowed, cohort, ended }.
  accessFor(email) {
    const found = this.entryFor(email);
    const cohort = found?.cohort ?? null;
    if (this.isAdmin(email) || this.consoleSignIn()) return { allowed: true, cohort, ended: false };
    if (!found) return { allowed: false, cohort: null, ended: false };
    return { allowed: !found.ended, cohort, ended: found.ended };
  }

  // Adds pasted lines to a cohort. An entry already listed moves to this cohort.
  addEntries(cohortId, text, admin) {
    const cohort = this.cohort(cohortId);
    const added = [];
    const invalid = [];
    transaction(this.db, () => {
      for (const line of String(text ?? "").split(/[\n,]+/)) {
        const entry = parseEntry(line);
        if (!entry) continue;
        if (entry.error) {
          invalid.push(entry.error);
          continue;
        }
        this.db
          .prepare(
            `INSERT INTO allowlist (kind, value, cohort_id, added_by, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (kind, value) DO UPDATE SET cohort_id = excluded.cohort_id`,
          )
          .run(entry.kind, entry.value, cohort.id, admin, this.now());
        added.push(entry);
      }
    });
    if (added.length) this.record(null, "allowlist_added", null, { by: admin, cohort: cohort.name, entries: added.map((e) => e.value) });
    return { added, invalid };
  }

  removeEntry(id, admin) {
    const entry = this.db.prepare("SELECT * FROM allowlist WHERE id = ?").get(id);
    if (!entry) throw fail(404, "No such entry.");
    this.db.prepare("DELETE FROM allowlist WHERE id = ?").run(id);
    this.record(null, "allowlist_removed", null, { by: admin, entry: entry.value });
  }

  entries(cohortId) {
    return this.db.prepare("SELECT id, kind, value, added_by AS addedBy, created_at AS createdAt FROM allowlist WHERE cohort_id = ? ORDER BY kind DESC, value").all(cohortId);
  }

  // --- Cohorts ------------------------------------------------------------------------------

  cohort(id) {
    const cohort = this.db.prepare("SELECT * FROM cohorts WHERE id = ?").get(Number(id));
    if (!cohort) throw fail(404, "No such cohort.");
    return cohort;
  }

  cohorts() {
    return this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM allowlist a WHERE a.cohort_id = c.id) AS entry_count
         FROM cohorts c ORDER BY c.builtin DESC, c.created_at DESC`,
      )
      .all()
      .map((c) => ({
        id: c.id,
        name: c.name,
        path: c.path,
        endsAt: c.ends_at,
        allowanceMinutes: c.allowance_minutes,
        builtin: Boolean(c.builtin),
        active: this.cohortActive(c),
        entryCount: c.entry_count,
      }));
  }

  saveCohort({ id, name, path, endsAt, allowanceMinutes }, admin) {
    const clean = {
      name: String(name ?? "").trim().slice(0, 80),
      path: path ? String(path) : null,
      endsAt: endsAt ? Number(endsAt) : null,
      allowance: Math.max(0, Math.min(24 * 60, Math.round(Number(allowanceMinutes ?? DEFAULT_ALLOWANCE_MINUTES)))),
    };
    if (!clean.name) throw fail(400, "A cohort needs a name.");
    if (Number.isNaN(clean.allowance) || (clean.endsAt !== null && Number.isNaN(clean.endsAt))) throw fail(400, "The allowance or end date isn't a number.");
    try {
      if (id) {
        const cohort = this.cohort(id);
        // The built-in cohort keeps its name and never ends.
        if (cohort.builtin) Object.assign(clean, { name: cohort.name, endsAt: null });
        this.db.prepare("UPDATE cohorts SET name = ?, path = ?, ends_at = ?, allowance_minutes = ? WHERE id = ?").run(clean.name, clean.path, clean.endsAt, clean.allowance, cohort.id);
        this.record(null, "cohort_saved", null, { by: admin, cohort: clean.name });
        return this.cohort(cohort.id);
      }
      const row = this.db
        .prepare("INSERT INTO cohorts (name, path, ends_at, allowance_minutes, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(clean.name, clean.path, clean.endsAt, clean.allowance, this.now());
      this.record(null, "cohort_created", null, { by: admin, cohort: clean.name });
      return this.cohort(row.lastInsertRowid);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw fail(409, `There's already a cohort called ${clean.name}.`);
      throw err;
    }
  }

  // --- Sign-in codes ------------------------------------------------------------------------

  // Checks an email may be sent a code, and makes one: { email, code, delivery } where
  // delivery is "email", "console" (a local runner without email) or "none" (an e2e address).
  startSignIn(rawEmail, ip) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw fail(400, "That doesn't look like an email address.");
    const e2e = Boolean(this.e2eKey) && E2E_EMAIL.test(email);
    if (isPersonalEmail(email) && !this.isAdmin(email) && !this.consoleSignIn() && this.entryFor(email)?.entry.kind !== "email") {
      throw fail(400, "Please use your company email. Personal addresses (Gmail, Outlook and the like) can't sign up for the course.", "personal_email");
    }
    // The e2e tests sign in often, from one address, and are sent no email. (Their code is the
    // same every time, but wrong codes are limited per email whatever the code: verifySignIn.)
    for (const [limiter, key] of e2e ? [] : [[this.emailSends, email], [this.ipSends, ip ?? "?"]]) {
      const limit = limiter.take(key);
      if (!limit.ok) throw Object.assign(fail(429, `Too many codes asked for. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} min.`), { retryAfter: limit.retryAfterSeconds });
    }
    const code = e2e ? e2eSignInCode(this.e2eKey, email) : newSignInCode();
    this.db
      .prepare(
        `INSERT INTO sign_in_codes (email, code_hash, expires_at, tries) VALUES (?, ?, ?, 0)
         ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0`,
      )
      .run(email, hashSignInCode(this.secret, email, code), this.now() + CODE_TTL_MS);
    return { email, code, delivery: e2e ? "none" : this.consoleSignIn() ? "console" : "email" };
  }

  // Checks a code; on success it's used up, and the user is found or made. Returns the user.
  verifySignIn(rawEmail, code) {
    const email = normalizeEmail(rawEmail);
    const row = email && this.db.prepare("SELECT * FROM sign_in_codes WHERE email = ?").get(email);
    if (!row || row.expires_at <= this.now()) throw fail(400, "That code has expired. Ask for a new one.", "expired");
    if (this.wrongCodes.full(email)) throw fail(429, "Too many wrong codes. Try again in 15 minutes.", "expired");
    if (row.code_hash !== hashSignInCode(this.secret, email, String(code ?? "").replace(/\s+/g, ""))) {
      this.wrongCodes.take(email);
      if (row.tries + 1 >= CODE_TRIES) {
        this.db.prepare("DELETE FROM sign_in_codes WHERE email = ?").run(email);
        this.record(null, "code_failed", null, { email, final: true });
        throw fail(400, "Too many wrong tries. Ask for a new code.", "expired");
      }
      this.db.prepare("UPDATE sign_in_codes SET tries = tries + 1 WHERE email = ?").run(email);
      throw fail(400, `That code isn't right. ${CODE_TRIES - row.tries - 1} tries left.`, "wrong_code");
    }
    this.db.prepare("DELETE FROM sign_in_codes WHERE email = ?").run(email);
    let user = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      const id = newLearnerId();
      this.db.prepare("INSERT INTO users (id, email, company, created_at) VALUES (?, ?, ?, ?)").run(id, email, companyOf(email), this.now());
      user = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }
    if (user.status === "blocked") throw fail(403, "This account is blocked. Contact the course team.", "blocked");
    return user;
  }

  // --- Users --------------------------------------------------------------------------------

  user(id) {
    return id ? (this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) ?? null) : null;
  }

  userByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) ?? null;
  }

  // Who a session's user is now: null when they're gone or blocked; otherwise the user with
  // their access, whether they're an admin and their latest access request.
  sessionUser(id) {
    const user = this.user(id);
    if (!user || user.status === "blocked") return null;
    const access = this.accessFor(user.email);
    const now = this.now();
    // last_seen_at moves at most once a minute.
    if (!user.last_seen_at || now - user.last_seen_at > 60_000) this.db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, id);
    return { ...user, access, admin: this.isAdmin(user.email), request: this.latestRequest(id) };
  }

  // What the page is told about the signed-in user.
  describe(session) {
    if (!session) return null;
    const { email, name, role, company, access, admin, request } = session;
    return {
      email,
      name,
      role,
      company,
      admin,
      needsProfile: !name || !role,
      allowed: access.allowed,
      ended: access.ended,
      cohort: access.cohort ? { name: access.cohort.name, path: access.cohort.path } : null,
      request: request ? { status: request.status, reason: request.reason } : null,
    };
  }

  // Name and role: asked of everyone at their first sign-in. A user who isn't allowed in files
  // an access request with them (once: a pending or rejected one stands).
  setProfile(id, { name, role }) {
    const user = this.user(id);
    if (!user) throw fail(401, "Sign in first.");
    const clean = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
    if (!clean) throw fail(400, "Please enter your name.");
    if (!ROLES.includes(role)) throw fail(400, "Please pick your role.");
    this.db.prepare("UPDATE users SET name = ?, role = ? WHERE id = ?").run(clean, role, id);
    const access = this.accessFor(user.email);
    let requested = null;
    // A request that was approved, for someone not allowed now, was undone (removed from the
    // allowlist): they may ask again.
    const latest = this.latestRequest(id);
    if (!access.allowed && !access.ended && (!latest || latest.status === "approved")) requested = this.#fileRequest(id);
    return { requested };
  }

  users({ cohortId } = {}) {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
    return rows
      .map((u) => ({ user: u, access: this.accessFor(u.email) }))
      .filter(({ access }) => !cohortId || access.cohort?.id === Number(cohortId));
  }

  setStatus(id, status, admin) {
    if (!["active", "blocked"].includes(status)) throw fail(400, "Unknown status.");
    const user = this.user(id);
    if (!user) throw fail(404, "No such learner.");
    this.db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
    this.record(id, status === "blocked" ? "user_blocked" : "user_unblocked", null, { by: admin });
  }

  // Puts a learner in a cohort: an exact entry for their email there.
  moveToCohort(id, cohortId, admin) {
    const user = this.user(id);
    if (!user) throw fail(404, "No such learner.");
    this.addEntries(cohortId, user.email, admin);
  }

  // Removes a learner: their user, events and exact allowlist entry. Logged without the email.
  deleteUser(id, admin) {
    const user = this.user(id);
    if (!user) throw fail(404, "No such learner.");
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM events WHERE user_id = ?").run(id);
      this.db.prepare("DELETE FROM sandbox_minutes WHERE user_id = ?").run(id);
      this.db.prepare("DELETE FROM allowlist WHERE kind = 'email' AND value = ?").run(user.email);
      this.db.prepare("DELETE FROM sign_in_codes WHERE email = ?").run(user.email);
      // The admin log named them (allowlist changes, a code asked for before they had a user).
      const quoted = JSON.stringify(user.email);
      this.db.prepare("UPDATE events SET data = replace(data, ?, '\"(deleted)\"') WHERE instr(data, ?) > 0").run(quoted, quoted);
      this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    });
    this.record(null, "user_deleted", null, { by: admin });
  }

  // --- Access requests ----------------------------------------------------------------------

  latestRequest(userId) {
    return this.db.prepare("SELECT * FROM access_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId) ?? null;
  }

  #fileRequest(userId) {
    const id = Number(this.db.prepare("INSERT INTO access_requests (user_id, created_at) VALUES (?, ?)").run(userId, this.now()).lastInsertRowid);
    this.record(userId, "access_requested", null, {});
    return this.request(id);
  }

  request(id) {
    const row = this.db
      .prepare(
        `SELECT r.*, u.email, u.name, u.role, u.company FROM access_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
      )
      .get(Number(id));
    if (!row) throw fail(404, "No such request.");
    return row;
  }

  requests({ status } = {}) {
    const rows = this.db
      .prepare(
        `SELECT r.*, u.email, u.name, u.role, u.company FROM access_requests r JOIN users u ON u.id = r.user_id
         ${status ? "WHERE r.status = ?" : ""} ORDER BY r.status = 'pending' DESC, r.created_at DESC`,
      )
      .all(...(status ? [status] : []));
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      scope: r.scope,
      reason: r.reason,
      createdAt: r.created_at,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      email: r.email,
      domain: domainOf(r.email),
      name: r.name,
      role: r.role,
      company: r.company,
    }));
  }

  // Approves a request for its email or its whole domain (into the On-demand cohort), or
  // rejects it. Returns the request as decided.
  decide(id, { approve, scope = "email", reason = "" }, admin) {
    const request = this.request(id);
    if (request.status !== "pending") throw fail(409, "That request has already been decided.");
    if (approve && !["email", "domain"].includes(scope)) throw fail(400, "Approve the email or the domain.");
    if (approve && scope === "domain" && isPersonalEmail(request.email)) throw fail(400, "That's a personal email domain: approve the email only.");
    transaction(this.db, () => {
      if (approve) this.addEntries(this.onDemand, scope === "domain" ? `@${domainOf(request.email)}` : request.email, admin);
      this.db
        .prepare("UPDATE access_requests SET status = ?, scope = ?, reason = ?, decided_by = ?, decided_at = ? WHERE id = ?")
        .run(approve ? "approved" : "rejected", approve ? scope : null, approve ? null : String(reason ?? "").trim().slice(0, 500) || null, admin, this.now(), request.id);
    });
    this.record(request.user_id, approve ? "access_approved" : "access_rejected", null, { by: admin, scope: approve ? scope : undefined });
    return this.request(id);
  }
}
