// Feedback from signed-in users: what they say, of what kind, and where they were when they said
// it (the page, the exercise, the module, the guide's step, and a little more for bugs). Kept in
// the database, emailed to FEEDBACK_EMAILS, and shown in /admin.
import { RateLimiter } from "./ratelimit.mjs";

export const FEEDBACK_KINDS = ["bug", "confusing", "idea", "praise"];
export const MAX_MESSAGE = 5000;
const PAGES = ["home", "setup", "exercise", "admin"];

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const id = (value) => (typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null);

// Where the page said the learner was: only known fields, only short strings.
export function cleanContext(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const viewport = c.viewport && typeof c.viewport === "object" ? { width: Number(c.viewport.width) || null, height: Number(c.viewport.height) || null } : null;
  return {
    page: PAGES.includes(c.page) ? c.page : null,
    url: text(c.url, 300),
    exerciseId: id(c.exerciseId),
    exerciseTitle: text(c.exerciseTitle, 120),
    moduleId: id(c.moduleId),
    moduleTitle: text(c.moduleTitle, 120),
    beatId: id(c.beatId),
    beatTitle: text(c.beatTitle, 160),
    adminTab: id(c.adminTab),
    sandbox: id(c.sandbox),
    theme: c.theme === "dark" || c.theme === "light" ? c.theme : null,
    viewport,
  };
}

// "Exercise 2 · Durable session › A4 · Meet the Agent UI › Run the worker", or the page's name.
export function whereText(context) {
  if (!context) return "";
  const parts = [];
  if (context.exerciseTitle || context.exerciseId) parts.push(context.exerciseTitle ?? context.exerciseId);
  if (context.moduleId) parts.push(context.moduleTitle ? `${context.moduleId} · ${context.moduleTitle}` : context.moduleId);
  const step = context.beatTitle ?? context.beatId;
  // A module that's one step is often titled like it: "3. Restart the worker", "Restart the worker".
  if (step && step.replace(/^\d+\.\s*/, "").toLowerCase() !== context.moduleTitle?.toLowerCase()) parts.push(`step “${step}”`);
  if (parts.length) return parts.join(" › ");
  if (context.page === "home") return "The map";
  if (context.page === "setup") return "Setup";
  if (context.page === "admin") return `Admin panel${context.adminTab ? ` (${context.adminTab})` : ""}`;
  return context.page ?? "";
}

export class Feedback {
  constructor(db, { now = () => Date.now(), record = () => {}, perUser = 5, global = 100, windowMs = 10 * 60_000 } = {}) {
    this.db = db;
    this.now = now;
    this.record = record;
    this.limiter = new RateLimiter({ perKey: perUser, global, windowMs, now });
  }

  // Stores one: { message, kind?, context? } from a user. Returns it as the admin sees it.
  add(userId, { message, kind, context, userAgent } = {}) {
    const body = typeof message === "string" ? message.trim() : "";
    if (!body) throw fail(400, "Please write something first.");
    if (body.length > MAX_MESSAGE) throw fail(400, `Please keep it under ${MAX_MESSAGE} characters.`);
    if (kind !== undefined && kind !== null && kind !== "" && !FEEDBACK_KINDS.includes(kind)) throw fail(400, "Unknown kind of feedback.");
    const room = this.limiter.take(userId);
    if (!room.ok) throw fail(429, "That's a lot of feedback at once: thank you! Try again in a few minutes.", { retryAfter: room.retryAfterSeconds });
    const where = cleanContext(context);
    const extra = { ...where, userAgent: text(userAgent, 300) };
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO feedback (user_id, kind, message, page, exercise_id, module_id, beat_id, context, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, kind || null, body, where.page, where.exerciseId, where.moduleId, where.beatId, JSON.stringify(extra), this.now());
    const fbId = Number(lastInsertRowid);
    this.record(userId, "feedback_sent", where.moduleId, { id: fbId, kind: kind || null });
    return this.get(fbId);
  }

  markEmailed(fbId) {
    this.db.prepare("UPDATE feedback SET emailed_at = ? WHERE id = ?").run(this.now(), fbId);
  }

  get(fbId) {
    const row = this.db.prepare("SELECT f.*, u.email, u.name, u.role, u.company FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = ?").get(fbId);
    return row ? describe(row) : null;
  }

  // The latest first.
  list({ limit = 500 } = {}) {
    return this.db
      .prepare("SELECT f.*, u.email, u.name, u.role, u.company FROM feedback f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT ?")
      .all(limit)
      .map(describe);
  }
}

function describe(row) {
  const context = row.context ? JSON.parse(row.context) : {};
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    company: row.company,
    kind: row.kind,
    message: row.message,
    page: row.page,
    exerciseId: row.exercise_id,
    moduleId: row.module_id,
    beatId: row.beat_id,
    context,
    where: whereText(context),
    emailedAt: row.emailed_at,
    createdAt: row.created_at,
  };
}
