// The runner's SQLite database: users, cohorts and the allowlist, sign-in codes, access
// requests, the activity log, and feedback. One file, on a Fly volume when deployed
// (DATABASE_PATH); the runner is one machine, so nothing else writes to it. Migrations run at
// startup, in order, each once (PRAGMA user_version counts them).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  `
  CREATE TABLE cohorts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    path TEXT,
    ends_at INTEGER,
    allowance_minutes INTEGER NOT NULL DEFAULT 480,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE allowlist (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('email', 'domain')),
    value TEXT NOT NULL,
    cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
    added_by TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (kind, value)
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role TEXT,
    company TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    imported_at INTEGER,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER
  );
  CREATE TABLE sign_in_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE access_requests (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    scope TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL,
    decided_by TEXT,
    decided_at INTEGER
  );
  CREATE INDEX access_requests_user ON access_requests (user_id);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    user_id TEXT,
    type TEXT NOT NULL,
    module_id TEXT,
    data TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX events_user ON events (user_id, at);
  CREATE INDEX events_at ON events (at);
  CREATE TABLE presence (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL,
    since INTEGER NOT NULL,
    last_at INTEGER NOT NULL
  );
  CREATE TABLE module_time (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, module_id)
  );
  CREATE TABLE sandbox_minutes (
    user_id TEXT NOT NULL,
    minute INTEGER NOT NULL,
    PRIMARY KEY (user_id, minute)
  );
  `,
  // Feedback from signed-in users, with where they were when they sent it (feedback.mjs).
  `
  CREATE TABLE feedback (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT,
    message TEXT NOT NULL,
    page TEXT,
    exercise_id TEXT,
    module_id TEXT,
    beat_id TEXT,
    context TEXT,
    emailed_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX feedback_at ON feedback (created_at);
  `,
];

export function openDatabase(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { user_version: version } = db.prepare("PRAGMA user_version").get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}

// Runs fn in a transaction; inside another one, it's part of that one.
const depth = new WeakMap();
export function transaction(db, fn) {
  const level = depth.get(db) ?? 0;
  if (level > 0) {
    depth.set(db, level + 1);
    try {
      return fn();
    } finally {
      depth.set(db, level);
    }
  }
  db.exec("BEGIN");
  depth.set(db, 1);
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    depth.set(db, 0);
  }
}
