// The activity log, and what's derived from it: a learner's progress (modules passed, challenge
// picks, path), time on each module (heartbeats from a visible module page), and sandbox time
// against the daily allowance.
//
// Events are append-only rows: { user_id, type, module_id, data, at }. The server records sign-
// ins, the sandbox's lifecycle, helper questions, model-call counts and admin actions; the page
// sends what happens in it (BROWSER_EVENTS).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { xpFor } from "../web/src/challenge.js";
import { transaction } from "./db.mjs";

export const BROWSER_EVENTS = new Set(["module_opened", "module_passed", "check_failed", "challenge_pick", "boss_result", "path_set"]);
// A heartbeat counts for at most this much time on its module (one every 60s, with slack).
const HEARTBEAT_MAX_SECONDS = 90;
// Someone on one module this long without passing it, and still there, is stuck.
export const STUCK_MS = 10 * 60_000;
const ACTIVE_MS = 3 * 60_000;
const DAY_MS = 24 * 3600_000;
const MINUTE_MS = 60_000;

// The course's modules, challenges and paths, from the site's generated data. A runner without
// it (the site not built yet) takes any well-formed id.
export function loadCatalog(file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "generated", "course-data.json")) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return catalogOf(null);
  }
  return catalogOf(data);
}

export function catalogOf(data) {
  const modules = new Map((data?.modules ?? []).map((m) => [m.id, m]));
  const right = new Map();
  const choices = new Map();
  for (const exercise of data?.exercises ?? []) {
    for (const [id, challenge] of Object.entries(exercise.challenges ?? {})) {
      right.set(id, challenge.choices.find((c) => c.right)?.id ?? null);
      choices.set(id, new Map(challenge.choices.map((c) => [c.id, c.label ?? c.id])));
    }
  }
  const paths = new Map((data?.paths ?? []).map((p) => [p.id, p]));
  return {
    loaded: Boolean(data),
    modules,
    paths,
    rightChoice: (id) => right.get(id) ?? null,
    choiceLabel: (id, choice) => choices.get(id)?.get(choice) ?? choice,
    knows: (id) => (data ? modules.has(id) : /^[A-Za-z0-9-]{1,40}$/.test(String(id ?? ""))),
    knowsPath: (id) => (data ? paths.has(id) : /^[a-z0-9-]{1,60}$/.test(String(id ?? ""))),
    xpOf(id, attempts) {
      const m = modules.get(id);
      if (m?.kind === "challenge") return xpFor(attempts[id] ?? [], right.get(id) ?? null);
      return m?.xp ?? 0;
    },
  };
}

// Progress from a learner's events, in order: { completed, attempts, path, xp }.
export function deriveProgress(events, catalog) {
  const completed = [];
  const attempts = {};
  let path = null;
  for (const e of events) {
    const data = typeof e.data === "string" ? JSON.parse(e.data || "{}") : (e.data ?? {});
    if (e.type === "module_passed" && e.module_id && !completed.includes(e.module_id)) completed.push(e.module_id);
    else if (e.type === "challenge_pick" && e.module_id && data.choice) {
      const picks = attempts[e.module_id] ?? [];
      const right = catalog.rightChoice(e.module_id);
      // As the page records them (challenge.js addPick): nothing after the right one, no repeats.
      if (!picks.includes(data.choice) && !(right && picks.includes(right))) attempts[e.module_id] = [...picks, data.choice];
    } else if (e.type === "path_set") path = data.path ?? null;
  }
  const xp = completed.reduce((sum, id) => sum + catalog.xpOf(id, attempts), 0);
  return { completed, attempts, path, xp };
}

export class Activity {
  constructor(db, { catalog = loadCatalog(), now = () => Date.now() } = {}) {
    this.db = db;
    this.catalog = catalog;
    this.now = now;
    this.modelCalls = new Map(); // userId -> calls since the last flush
  }

  record(userId, type, moduleId = null, data = null) {
    this.db
      .prepare("INSERT INTO events (user_id, type, module_id, data, at) VALUES (?, ?, ?, ?, ?)")
      .run(userId ?? null, type, moduleId ?? null, data ? JSON.stringify(data) : null, this.now());
  }

  // The page's events, checked: known types, known modules, small data.
  recordFromBrowser(userId, events) {
    const list = Array.isArray(events) ? events.slice(0, 50) : [];
    let recorded = 0;
    transaction(this.db, () => {
      for (const e of list) {
        if (!BROWSER_EVENTS.has(e?.type)) continue;
        const moduleId = e.moduleId ?? null;
        if (e.type === "path_set") {
          if (e.data?.path !== null && !this.catalog.knowsPath(e.data?.path)) continue;
        } else if (!this.catalog.knows(moduleId)) continue;
        const data = e.data && typeof e.data === "object" ? e.data : null;
        if (data && JSON.stringify(data).length > 2000) continue;
        this.record(userId, e.type, moduleId, data);
        recorded++;
      }
    });
    return recorded;
  }

  eventsOf(userId) {
    return this.db.prepare("SELECT * FROM events WHERE user_id = ? ORDER BY at, id").all(userId);
  }

  // A learner's progress. The path is the one they picked, else their cohort's.
  progress(userId, cohortPath = null) {
    const derived = deriveProgress(this.eventsOf(userId), this.catalog);
    const picked = this.db.prepare("SELECT 1 FROM events WHERE user_id = ? AND type = 'path_set' LIMIT 1").get(userId);
    return { ...derived, path: picked ? derived.path : (cohortPath ?? null) };
  }

  // At a learner's first sign-in, the progress this browser had: recorded as events (source:
  // import), once per user. Returns whether it was imported.
  importProgress(userId, { completed = [], attempts = {}, path = null } = {}) {
    const user = this.db.prepare("SELECT imported_at FROM users WHERE id = ?").get(userId);
    if (!user || user.imported_at) return false;
    transaction(this.db, () => {
      this.db.prepare("UPDATE users SET imported_at = ? WHERE id = ?").run(this.now(), userId);
      const done = new Set(deriveProgress(this.eventsOf(userId), this.catalog).completed);
      for (const [id, picks] of Object.entries(attempts ?? {}).slice(0, 100)) {
        if (!this.catalog.knows(id) || !Array.isArray(picks)) continue;
        for (const choice of picks.slice(0, 10)) this.record(userId, "challenge_pick", id, { choice: String(choice).slice(0, 10), source: "import" });
      }
      for (const id of (Array.isArray(completed) ? completed : []).slice(0, 500)) {
        if (this.catalog.knows(id) && !done.has(id)) this.record(userId, "module_passed", id, { source: "import" });
      }
      if (path && this.catalog.knowsPath(path)) this.record(userId, "path_set", null, { path, source: "import" });
    });
    return true;
  }

  // A heartbeat from a visible module page: the learner's "on module X since T", and their time
  // on it. Not an event.
  heartbeat(userId, moduleId) {
    if (!this.catalog.knows(moduleId)) return false;
    const now = this.now();
    const here = this.db.prepare("SELECT * FROM presence WHERE user_id = ?").get(userId);
    transaction(this.db, () => {
      if (here?.module_id === moduleId) {
        const seconds = Math.min(HEARTBEAT_MAX_SECONDS, Math.max(0, Math.round((now - here.last_at) / 1000)));
        this.db.prepare("UPDATE presence SET last_at = ? WHERE user_id = ?").run(now, userId);
        this.db
          .prepare(
            `INSERT INTO module_time (user_id, module_id, seconds) VALUES (?, ?, ?)
             ON CONFLICT (user_id, module_id) DO UPDATE SET seconds = seconds + excluded.seconds`,
          )
          .run(userId, moduleId, seconds);
      } else {
        this.db
          .prepare(
            `INSERT INTO presence (user_id, module_id, since, last_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (user_id) DO UPDATE SET module_id = excluded.module_id, since = excluded.since, last_at = excluded.last_at`,
          )
          .run(userId, moduleId, now, now);
      }
    });
    return true;
  }

  presence(userId) {
    return this.db.prepare("SELECT * FROM presence WHERE user_id = ?").get(userId) ?? null;
  }

  moduleTimes(userId) {
    return Object.fromEntries(this.db.prepare("SELECT module_id, seconds FROM module_time WHERE user_id = ?").all(userId).map((r) => [r.module_id, r.seconds]));
  }

  // Where a learner is: { moduleId, minutes, active, stuck }. Stuck: on one module for 10+
  // minutes by heartbeat, not passed, and still there.
  whereIs(userId, completed) {
    const here = this.presence(userId);
    if (!here) return null;
    const now = this.now();
    const active = now - here.last_at < ACTIVE_MS;
    const onIt = here.last_at - here.since;
    return {
      moduleId: here.module_id,
      minutes: Math.floor(onIt / MINUTE_MS),
      lastAt: here.last_at,
      active,
      stuck: active && onIt >= STUCK_MS && !completed.includes(here.module_id),
    };
  }

  // --- Model calls --------------------------------------------------------------------------

  countModelCall(userId) {
    this.modelCalls.set(userId, (this.modelCalls.get(userId) ?? 0) + 1);
  }

  // One event per learner per minute with the calls they made, not one per call.
  flushModelCalls() {
    const calls = [...this.modelCalls];
    this.modelCalls.clear();
    for (const [userId, count] of calls) this.record(userId, "model_calls", null, { count });
  }

  // --- Sandbox time -------------------------------------------------------------------------

  // A minute a learner's sandbox was running (the sweep, once a minute).
  countSandboxMinute(userId, at = this.now()) {
    this.db.prepare("INSERT OR IGNORE INTO sandbox_minutes (user_id, minute) VALUES (?, ?)").run(userId, Math.floor(at / MINUTE_MS));
  }

  pruneSandboxMinutes() {
    this.db.prepare("DELETE FROM sandbox_minutes WHERE minute < ?").run(Math.floor((this.now() - 2 * DAY_MS) / MINUTE_MS));
  }

  // Sandbox time in the last 24 hours against the allowance: { usedMinutes, limitMinutes,
  // remainingMinutes, freesAt } (freesAt: when enough time has rolled out of the window to start
  // again, when there's none left; else null).
  allowance(userId, limitMinutes) {
    const now = this.now();
    const from = Math.floor((now - DAY_MS) / MINUTE_MS);
    const minutes = this.db.prepare("SELECT minute FROM sandbox_minutes WHERE user_id = ? AND minute > ? ORDER BY minute").all(userId, from).map((r) => r.minute);
    const used = minutes.length;
    let freesAt = null;
    if (used >= limitMinutes && used > 0) {
      // Under the limit again once the (used - limit + 1) oldest minutes have rolled out.
      const minute = minutes[Math.min(used - 1, used - limitMinutes)];
      freesAt = minute * MINUTE_MS + DAY_MS;
    }
    return { usedMinutes: used, limitMinutes, remainingMinutes: Math.max(0, limitMinutes - used), freesAt };
  }

  sandboxMinutesToday(userId) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM sandbox_minutes WHERE user_id = ? AND minute > ?").get(userId, Math.floor((this.now() - DAY_MS) / MINUTE_MS)).n;
  }
}
