// The Derby: a live race through Essentials. An admin makes an event (a race, with a cohort of
// its own); people join it with its code, a name and a jockey, and no email; the race screen
// shows them as horses, each as far down the track as their XP.
//
// It's a race for understanding, not speed: a module's XP depends on how its question went (all
// of it on the first try, less after), as a challenge's does; at the same XP, fewer slips (wrong
// answers, bosses lost) win, and only then the clock. The finish line is a perfect score; the
// race ends when the clock runs out (or everyone has done every stop).
//
// A racer is a user like any other (their events, progress and sandbox are the course's own),
// with a made-up address nobody can sign in with (racer-…@derby.invalid), on the allowlist of the
// race's cohort, whose path is Essentials'. They get back in on another device with their
// pit-pass. Their score counts only what they did between the gun and the finish.
//
// Ghosts are scripted racers for a rehearsal: no user, their events made up from the start time
// as they're asked for, so they go through the same scoring as everyone else.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CREATURES,
  HORSE_MAX,
  HORSE_NAMES,
  NAME_MAX,
  PATTERNS,
  SILKS,
  coatOf,
  newJoinCode,
  newPitPass,
  normalizeCode,
  normalizePitPass,
} from "../web/src/race/avatars.js";
import { quizXp, stopXp } from "../web/src/race/rules.js";
import { DEFAULT_ALLOWANCE_MINUTES } from "./accounts.mjs";
import { deriveProgress } from "./activity.mjs";
import { newLearnerId } from "./auth.mjs";
import { transaction } from "./db.mjs";

export const RACE_PATH = "essentials";
export const COUNTDOWN_MS = 4000;
export const PODIUM_DELAY_MS = 8000;
// A racer grazes after this long with no progress, unless they're on a module page (reading, or
// asking Temporal): taking time over it is the point.
export const GRAZE_MS = 15 * 60_000;
const PRESENT_MS = 3 * 60_000;
// Ghosts graze sooner: a rehearsal shouldn't wait to see it.
export const GHOST_GRAZE_MS = 60_000;
export { QUESTION_XP, QUIZ_SHARE, quizXp } from "../web/src/race/rules.js";
export const DEFAULT_DURATION = 75;
export const MAX_RACERS = SILKS.length;
export const GHOST_FIELD = 15;
// Access ends this long after the clock runs out.
const ACCESS_AFTER_MS = 24 * 3600_000;
const STATE_CACHE_MS = 900;

// What the race screen calls each stop: a word or two for its post, that reads in the commentary
// ("clears The seat hold", "stumbles at The bad minute").
const SHORT = {
  E1: "The logbook",
  E2: "The bug",
  E3: "Airline blips",
  EC1: "The bad minute",
  E4: "The empty office",
  E5: "The pulled plug",
  EC2: "The next shift",
  E6: "The seat hold",
  E7: "The manager's OK",
  E8: "The clean undo",
  EC3: "The declined card",
  "E-boss": "The Night Shift",
};

const GHOST_NAMES = ["Casper", "Boo", "Spook", "Wisp", "Shade", "Phantom", "Misty", "Echo", "Vapour", "Haunt", "Poltergus", "Banshee", "Spectra", "Glimmer", "Nimbus", "Whisper", "Fog", "Shroud", "Murmur", "Gloom"];

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

// --- The course the race runs on ------------------------------------------------------------

// Essentials' stops in order (its modules, then its boss), each with its race XP (every question
// the same, rules.js stopXp) and where it stands on the track (the XP of a racer who has passed it
// and everything before it, all on the first try).
export function raceCourse(data) {
  const branch = data?.branches?.find((b) => b.id === "essentials");
  const modules = new Map((data?.modules ?? []).map((m) => [m.id, m]));
  const ids = branch ? [...branch.modules, ...(branch.boss ? [branch.boss] : [])].filter((id) => modules.has(id)) : [];
  const right = new Map();
  const wrong = new Map();
  // A module's question (its world check's quiz): the right answer, and the others.
  const quizRight = new Map();
  const quizWrong = new Map();
  for (const exercise of data?.exercises ?? []) {
    for (const [id, challenge] of Object.entries(exercise.challenges ?? {})) {
      right.set(id, challenge.choices.find((c) => c.right)?.id ?? null);
      wrong.set(id, challenge.choices.filter((c) => !c.right).map((c) => c.id));
    }
    for (const [id, check] of Object.entries(exercise.checks ?? {})) {
      if (!check.quiz?.choices) continue;
      quizRight.set(id, check.quiz.choices.find((c) => c.right)?.id ?? null);
      quizWrong.set(id, check.quiz.choices.filter((c) => !c.right).map((c) => c.id));
    }
  }
  let at = 0;
  const stops = ids.map((id) => {
    const m = modules.get(id);
    const xp = stopXp(m.kind, m.xp ?? 0);
    at += xp;
    const emoji = m.emoji ?? (m.kind === "challenge" ? "⚡" : m.kind === "boss" ? "🌙" : "•");
    return { id, kind: m.kind, title: m.title, short: SHORT[id] ?? m.title, emoji, xp, at };
  });
  const badges = Object.fromEntries((data?.badges ?? []).map((b) => [b.id, b]));
  return { stops, ids: new Set(ids), stopXp: new Map(stops.map((s) => [s.id, s.xp])), modules, maxXp: at, bossId: branch?.boss ?? null, right, wrong, quizRight, quizWrong, badges };
}

export function loadRaceCourse(file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "generated", "course-data.json")) {
  try {
    return raceCourse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return raceCourse(null);
  }
}

// --- Scoring -----------------------------------------------------------------------------------

// A racer's race from their events (in order, already cut to the race's window): XP, and when
// they got it; slips (wrong answers to a module's question or a challenge, bosses lost), the
// first tiebreak; the stop they passed last; badges; when they'd done every stop; and when they
// last did anything that moves a horse.
export function scoreRacer(events, catalog, course) {
  const completed = [];
  const attempts = {}; // challenge picks
  const answers = {}; // module question picks
  let xp = 0;
  let xpAt = null;
  let stumbles = 0;
  let stop = null;
  let finishedAt = null;
  let lastMoveAt = null;
  // A stop's race XP: a question's (a challenge's, or the one ending a module) by its first right
  // try; the boss's, all of it.
  const xpOf = (id) => {
    const full = course.stopXp.get(id) ?? 0;
    if (course.modules?.get(id)?.kind === "challenge") return quizXp(full, attempts[id], course.right.get(id) ?? catalog.rightChoice?.(id) ?? null);
    if (course.quizRight.has(id)) return quizXp(full, answers[id], course.quizRight.get(id));
    return full;
  };
  // A pick for a question or a challenge: kept as the page keeps it (no repeats, nothing after
  // the right one); a wrong one is a slip.
  const addPick = (picks, id, choice, right, at) => {
    const list = picks[id] ?? [];
    if (list.includes(choice) || (right && list.includes(right))) return;
    picks[id] = [...list, choice];
    if (choice !== right) stumbles++;
    lastMoveAt = at;
  };
  for (const e of events) {
    const data = typeof e.data === "string" ? JSON.parse(e.data || "{}") : (e.data ?? {});
    const id = e.module_id;
    if (!course.ids.has(id)) continue;
    if (e.type === "module_passed" && !completed.includes(id)) {
      completed.push(id);
      const now = completed.reduce((sum, m) => sum + xpOf(m), 0);
      if (now > xp) {
        xp = now;
        xpAt = e.at;
      }
      stop = id;
      lastMoveAt = e.at;
      if (completed.length === course.ids.size) finishedAt = e.at;
    } else if (e.type === "challenge_pick" && data.choice) {
      addPick(attempts, id, data.choice, course.right.get(id) ?? catalog.rightChoice?.(id) ?? null, e.at);
    } else if (e.type === "quiz_pick" && data.choice && !completed.includes(id)) {
      addPick(answers, id, data.choice, course.quizRight.get(id) ?? null, e.at);
    } else if (e.type === "boss_result" && id === course.bossId && !data.won) {
      stumbles++;
      lastMoveAt = e.at;
    }
  }
  const badges = deriveProgress(events, catalog).badges.map((b) => b.id);
  return { xp, xpAt, completed: completed.length, stop, stumbles, badges, finishedAt, lastMoveAt };
}

// Highest XP first; at the same XP, fewer slips; then whoever got there first; then whoever
// joined first.
export function rank(racers) {
  return [...racers].sort((a, b) => b.xp - a.xp || a.stumbles - b.stumbles || (a.xpAt ?? Infinity) - (b.xpAt ?? Infinity) || a.lane - b.lane);
}

// --- Ghosts ------------------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A ghost's events from the gun: through every stop in four to six and a half minutes, with
// the odd wrong answer and lost boss. The grazer stops for two minutes on the way; the twin runs
// its partner's race a second behind.
export function ghostEvents({ seed, script }, startedAt, course) {
  const random = rng(script === "twin" ? seed - 1 : seed);
  const out = [];
  const total = 240_000 + random() * 150_000;
  const step = total / Math.max(1, course.stops.length);
  const mistakes = 0.15 + random() * 0.45;
  let t = startedAt + (script === "twin" ? 1200 : 0);
  const push = (type, moduleId, data = null) => out.push({ type, module_id: moduleId, data, at: Math.round(t) });
  course.stops.forEach((stop, i) => {
    t += step * (0.55 + random() * 0.9);
    if (script === "grazer" && i === Math.floor(course.stops.length / 2)) t += 120_000;
    if (stop.kind === "challenge") {
      const wrong = course.wrong.get(stop.id) ?? [];
      if (wrong.length && random() < mistakes) {
        push("challenge_pick", stop.id, { choice: wrong[Math.floor(random() * wrong.length)], right: false });
        t += 9000;
      }
      push("challenge_pick", stop.id, { choice: course.right.get(stop.id), right: true });
      push("module_passed", stop.id);
    } else if (stop.kind === "boss") {
      const lost = random() < 0.35;
      if (lost) {
        push("boss_result", stop.id, { won: false, hearts: 0 });
        t += 25_000;
      }
      push("boss_result", stop.id, { won: true, hearts: lost ? 1 + Math.floor(random() * 2) : 3 });
      push("module_passed", stop.id);
    } else {
      const wrong = course.quizWrong.get(stop.id) ?? [];
      if (wrong.length && random() < mistakes) {
        push("quiz_pick", stop.id, { choice: wrong[Math.floor(random() * wrong.length)], right: false });
        t += 6000;
      }
      if (course.quizRight.has(stop.id)) push("quiz_pick", stop.id, { choice: course.quizRight.get(stop.id), right: true });
      push("module_passed", stop.id);
    }
  });
  return out;
}

// --- Races -------------------------------------------------------------------------------------

const slugify = (name) =>
  String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "race";

const cleanName = (raw, max) => String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export class Races {
  constructor(db, { accounts, activity, manager = null, course = loadRaceCourse(), now = () => Date.now(), random = Math.random } = {}) {
    this.db = db;
    this.accounts = accounts;
    this.activity = activity;
    this.manager = manager;
    this.course = course;
    this.now = now;
    this.random = random;
    this.cache = new Map(); // race id -> { at, state }
  }

  #changed(id) {
    this.cache.delete(Number(id));
  }

  // --- Reading ---------------------------------------------------------------------------------

  race(id) {
    const race = this.db.prepare("SELECT * FROM races WHERE id = ?").get(Number(id));
    if (!race) throw fail(404, "No such race.");
    return race;
  }

  bySlug(slug) {
    const race = this.db.prepare("SELECT * FROM races WHERE slug = ?").get(String(slug ?? ""));
    if (!race) throw fail(404, "No such race.");
    return race;
  }

  byCode(raw) {
    const race = this.db.prepare("SELECT * FROM races WHERE join_code = ?").get(normalizeCode(raw));
    if (!race) throw fail(404, "That code isn't a race. Check it on the big screen.", "no_race");
    return race;
  }

  racers(raceId) {
    return this.db.prepare("SELECT * FROM racers WHERE race_id = ? ORDER BY created_at, id").all(Number(raceId));
  }

  // The racer a user is, with their race, or null.
  racerOf(userId) {
    if (!userId) return null;
    const racer = this.db.prepare("SELECT * FROM racers WHERE user_id = ?").get(userId);
    return racer ? { racer, race: this.race(racer.race_id) } : null;
  }

  // What the page is told about a racer who's signed in (the session).
  describeRacer(userId) {
    const found = this.racerOf(userId);
    if (!found) return null;
    const { racer, race } = found;
    return { raceName: race.name, slug: race.slug, name: racer.name, horse: racer.horse, creature: racer.creature, silks: racer.silks, pattern: racer.pattern, pitPass: racer.pit_pass };
  }

  list() {
    return this.db
      .prepare("SELECT r.*, (SELECT COUNT(*) FROM racers x WHERE x.race_id = r.id) AS racer_count FROM races r ORDER BY r.created_at DESC")
      .all()
      .map((r) => ({ ...this.#summary(r), racerCount: r.racer_count }));
  }

  #summary(race) {
    return {
      id: race.id,
      name: race.name,
      slug: race.slug,
      joinCode: race.join_code,
      durationMinutes: race.duration_minutes,
      extraMinutes: race.extra_minutes,
      sound: Boolean(race.sound),
      startedAt: race.started_at,
      endedAt: race.ended_at,
      podiumAt: race.podium_at,
      createdAt: race.created_at,
      cohortId: race.cohort_id,
    };
  }

  // --- Making and running races (admin) ------------------------------------------------------

  #uniqueSlug(name, exceptId = null) {
    const base = slugify(name);
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const found = this.db.prepare("SELECT id FROM races WHERE slug = ?").get(slug);
      if (!found || found.id === exceptId) return slug;
    }
  }

  #freeCode() {
    for (let i = 0; i < 200; i++) {
      const code = newJoinCode(this.random);
      if (!this.db.prepare("SELECT 1 FROM races WHERE join_code = ?").get(code)) return code;
    }
    throw fail(500, "Couldn't find a free join code.");
  }

  #checkCode(raw, exceptId = null) {
    const code = normalizeCode(raw);
    if (code.length < 4) throw fail(400, "A join code needs at least 4 letters or digits.");
    const found = this.db.prepare("SELECT id FROM races WHERE join_code = ?").get(code);
    if (found && found.id !== exceptId) throw fail(409, `Another race already uses ${code}.`);
    return code;
  }

  #cohortName(name) {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? `🏇 ${name}` : `🏇 ${name} (${n})`;
      if (!this.db.prepare("SELECT 1 FROM cohorts WHERE name = ?").get(candidate)) return candidate;
    }
  }

  create({ name, durationMinutes = DEFAULT_DURATION, joinCode = "", sound = true } = {}, admin = null) {
    const clean = cleanName(name, 60);
    if (!clean) throw fail(400, "A race needs a name.");
    const duration = Math.round(Number(durationMinutes));
    if (!(duration >= 5 && duration <= 600)) throw fail(400, "The duration is in minutes, from 5 to 600.");
    return transaction(this.db, () => {
      const code = joinCode ? this.#checkCode(joinCode) : this.#freeCode();
      const now = this.now();
      const cohortId = Number(
        this.db
          .prepare("INSERT INTO cohorts (name, path, ends_at, allowance_minutes, created_at) VALUES (?, ?, NULL, ?, ?)")
          .run(this.#cohortName(clean), RACE_PATH, DEFAULT_ALLOWANCE_MINUTES, now).lastInsertRowid,
      );
      const id = Number(
        this.db
          .prepare("INSERT INTO races (cohort_id, name, slug, join_code, duration_minutes, sound, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(cohortId, clean, this.#uniqueSlug(clean), code, duration, sound ? 1 : 0, now).lastInsertRowid,
      );
      this.activity.record(null, "race_created", null, { by: admin, race: clean });
      return this.#summary(this.race(id));
    });
  }

  update(id, { name, durationMinutes, joinCode, sound } = {}) {
    const race = this.race(id);
    const next = {
      name: name === undefined ? race.name : cleanName(name, 60),
      duration: durationMinutes === undefined ? race.duration_minutes : Math.round(Number(durationMinutes)),
      code: joinCode === undefined ? race.join_code : this.#checkCode(joinCode, race.id),
      sound: sound === undefined ? race.sound : sound ? 1 : 0,
    };
    if (!next.name) throw fail(400, "A race needs a name.");
    if (!(next.duration >= 5 && next.duration <= 600)) throw fail(400, "The duration is in minutes, from 5 to 600.");
    this.db
      .prepare("UPDATE races SET name = ?, slug = ?, join_code = ?, duration_minutes = ?, sound = ? WHERE id = ?")
      .run(next.name, next.name === race.name ? race.slug : this.#uniqueSlug(next.name, race.id), next.code, next.duration, next.sound, race.id);
    this.#syncAccess(race.id);
    this.#changed(race.id);
    return this.#summary(this.race(race.id));
  }

  // The race's cohort lets its racers in until a day after the clock runs out.
  #syncAccess(id) {
    const race = this.race(id);
    const endsAt = race.started_at ? race.started_at + (race.duration_minutes + race.extra_minutes) * 60_000 + ACCESS_AFTER_MS : null;
    this.db.prepare("UPDATE cohorts SET ends_at = ? WHERE id = ?").run(endsAt, race.cohort_id);
  }

  // Start (the gun goes in COUNTDOWN_MS: 3, 2, 1), +5 minutes, End now, Reveal the podium.
  act(id, action, admin = null) {
    const race = this.race(id);
    const now = this.now();
    const timing = this.timing(race);
    if (action === "start") {
      if (race.started_at) throw fail(409, "This race has already started.");
      this.db.prepare("UPDATE races SET started_at = ? WHERE id = ?").run(now + COUNTDOWN_MS, race.id);
    } else if (action === "extend") {
      if (!race.started_at || timing.phase === "finished") throw fail(409, "Only a race that's running can have more time.");
      this.db.prepare("UPDATE races SET extra_minutes = extra_minutes + 5 WHERE id = ?").run(race.id);
    } else if (action === "end") {
      if (!race.started_at || timing.phase === "finished") throw fail(409, "This race isn't running.");
      this.db.prepare("UPDATE races SET ended_at = ? WHERE id = ?").run(Math.max(now, race.started_at), race.id);
    } else if (action === "podium") {
      if (!race.started_at) throw fail(409, "This race hasn't started.");
      if (timing.phase !== "finished") this.db.prepare("UPDATE races SET ended_at = ? WHERE id = ?").run(Math.max(now, race.started_at), race.id);
      this.db.prepare("UPDATE races SET podium_at = ? WHERE id = ?").run(now, race.id);
    } else if (action === "mute" || action === "unmute") {
      this.db.prepare("UPDATE races SET sound = ? WHERE id = ?").run(action === "unmute" ? 1 : 0, race.id);
    } else throw fail(400, "Unknown action.");
    this.#syncAccess(race.id);
    this.#changed(race.id);
    if (["start", "end", "podium"].includes(action)) this.activity.record(null, `race_${action}`, null, { by: admin, race: race.name });
    return this.#summary(this.race(race.id));
  }

  // Back to the lobby: every racer (and their account) gone, the settings kept.
  reset(id, admin = null) {
    const race = this.race(id);
    for (const r of this.racers(race.id)) this.#removeRacer(r, admin);
    this.db.prepare("UPDATE races SET started_at = NULL, ended_at = NULL, podium_at = NULL, extra_minutes = 0 WHERE id = ?").run(race.id);
    this.#syncAccess(race.id);
    this.#changed(race.id);
    this.activity.record(null, "race_reset", null, { by: admin, race: race.name });
    return this.#summary(this.race(race.id));
  }

  duplicate(id, admin = null) {
    const race = this.race(id);
    return this.create({ name: `${race.name} (copy)`, durationMinutes: race.duration_minutes, sound: Boolean(race.sound) }, admin);
  }

  remove(id, admin = null) {
    const race = this.race(id);
    for (const r of this.racers(race.id)) this.#removeRacer(r, admin);
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM races WHERE id = ?").run(race.id);
      this.db.prepare("DELETE FROM allowlist WHERE cohort_id = ?").run(race.cohort_id);
      this.db.prepare("DELETE FROM cohorts WHERE id = ?").run(race.cohort_id);
    });
    this.#changed(race.id);
    this.activity.record(null, "race_deleted", null, { by: admin, race: race.name });
  }

  // Fills the field to GHOST_FIELD with ghosts, before the start.
  fillGhosts(id) {
    const race = this.race(id);
    if (race.started_at) throw fail(409, "Ghosts join before the start.");
    const racers = this.racers(race.id);
    const takenNames = new Set(racers.map((r) => r.name_key));
    const takenHorses = new Set(racers.map((r) => r.horse));
    const takenSilks = new Set(racers.map((r) => r.silks));
    const want = Math.max(0, GHOST_FIELD - racers.length);
    const base = Math.floor(this.random() * 1e6) * 100;
    transaction(this.db, () => {
      for (let i = 0; i < want; i++) {
        const name = GHOST_NAMES.find((n) => !takenNames.has(n.toLowerCase()));
        const horse = HORSE_NAMES.find((n) => !takenHorses.has(n)) ?? `Ghost ${i + 1}`;
        const silks = SILKS.find((s) => !takenSilks.has(s.id));
        if (!name || !silks) break;
        takenNames.add(name.toLowerCase());
        takenHorses.add(horse);
        takenSilks.add(silks.id);
        // The second ghost is the first's twin (a photo finish); the fourth grazes.
        const script = i === 1 ? "twin" : i === 3 ? "grazer" : "normal";
        this.db
          .prepare(
            `INSERT INTO racers (race_id, user_id, ghost, seed, script, name, name_key, horse, creature, silks, pattern, created_at)
             VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(race.id, base + i, script, name, name.toLowerCase(), horse, CREATURES[(base / 100 + i * 5) % CREATURES.length].id, silks.id, PATTERNS[i % PATTERNS.length].id, this.now() + i);
      }
    });
    this.#changed(race.id);
    return this.racers(race.id).length;
  }

  renameRacer(racerId, name) {
    const racer = this.db.prepare("SELECT * FROM racers WHERE id = ?").get(Number(racerId));
    if (!racer) throw fail(404, "No such racer.");
    const clean = cleanName(name, NAME_MAX);
    if (!clean) throw fail(400, "A racer needs a name.");
    const clash = this.db.prepare("SELECT id FROM racers WHERE race_id = ? AND name_key = ? AND id != ?").get(racer.race_id, clean.toLowerCase(), racer.id);
    if (clash) throw fail(409, `There's already a ${clean} in this race.`);
    this.db.prepare("UPDATE racers SET name = ?, name_key = ? WHERE id = ?").run(clean, clean.toLowerCase(), racer.id);
    if (racer.user_id) this.db.prepare("UPDATE users SET name = ? WHERE id = ?").run(clean, racer.user_id);
    this.#changed(racer.race_id);
  }

  removeRacer(racerId, admin = null) {
    const racer = this.db.prepare("SELECT * FROM racers WHERE id = ?").get(Number(racerId));
    if (!racer) throw fail(404, "No such racer.");
    this.#removeRacer(racer, admin);
    this.#changed(racer.race_id);
  }

  // A racer's account goes with them: it was only ever for the race.
  #removeRacer(racer, admin) {
    if (racer.user_id && this.accounts.user(racer.user_id)) this.accounts.deleteUser(racer.user_id, admin);
    this.db.prepare("DELETE FROM racers WHERE id = ?").run(racer.id);
  }

  // --- Joining ---------------------------------------------------------------------------------

  // What the join page needs, for a code: the race, and what's taken.
  joinInfo(code) {
    const race = this.byCode(code);
    const racers = this.racers(race.id);
    const { phase } = this.timing(race);
    return {
      race: { name: race.name, slug: race.slug, joinCode: race.join_code, phase },
      takenSilks: racers.map((r) => r.silks),
      takenHorses: racers.map((r) => r.horse),
      count: racers.length,
      full: racers.length >= MAX_RACERS,
      open: phase !== "finished",
    };
  }

  // A new racer: their user (and allowlist entry, in the race's cohort), and their racer.
  // Returns { user, racer }.
  join(code, { name, horse, creature, silks, pattern } = {}) {
    const race = this.byCode(code);
    if (this.timing(race).phase === "finished") throw fail(409, "This race is over.", "race_over");
    const cleanPerson = cleanName(name, NAME_MAX);
    const cleanHorse = cleanName(horse, HORSE_MAX);
    if (!cleanPerson) throw fail(400, "Please enter your name.");
    if (!cleanHorse) throw fail(400, "Your horse needs a name.");
    if (!CREATURES.some((c) => c.id === creature)) throw fail(400, "Pick a jockey.");
    if (!SILKS.some((s) => s.id === silks)) throw fail(400, "Pick your silks' colour.");
    if (!PATTERNS.some((p) => p.id === pattern)) throw fail(400, "Pick your silks' pattern.");
    return transaction(this.db, () => {
      const racers = this.racers(race.id);
      if (racers.length >= MAX_RACERS) throw fail(409, "The field is full.", "full");
      if (racers.some((r) => r.name_key === cleanPerson.toLowerCase())) throw fail(409, `There's already a ${cleanPerson} in this race. Add an initial?`, "name_taken");
      if (racers.some((r) => r.silks === silks)) throw fail(409, "Someone just took that colour. Pick another.", "silks_taken");
      const now = this.now();
      const id = newLearnerId();
      const email = `racer-${crypto.randomBytes(8).toString("hex")}@derby.invalid`;
      this.db.prepare("INSERT INTO users (id, email, name, role, imported_at, created_at) VALUES (?, ?, ?, 'Racer', ?, ?)").run(id, email, cleanPerson, now, now);
      this.db.prepare("INSERT INTO allowlist (kind, value, cohort_id, added_by, created_at) VALUES ('email', ?, ?, 'race', ?)").run(email, race.cohort_id, now);
      let pitPass;
      do pitPass = newPitPass(this.random);
      while (this.db.prepare("SELECT 1 FROM racers WHERE pit_pass = ?").get(pitPass));
      const racerId = Number(
        this.db
          .prepare(
            `INSERT INTO racers (race_id, user_id, ghost, name, name_key, horse, creature, silks, pattern, pit_pass, created_at)
             VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(race.id, id, cleanPerson, cleanPerson.toLowerCase(), cleanHorse, creature, silks, pattern, pitPass, now).lastInsertRowid,
      );
      this.activity.record(id, "race_joined", null, { race: race.name });
      this.#changed(race.id);
      return { user: this.accounts.user(id), racer: this.db.prepare("SELECT * FROM racers WHERE id = ?").get(racerId) };
    });
  }

  // A racer back in, on another device: their user.
  resume(pitPass) {
    const racer = this.db.prepare("SELECT * FROM racers WHERE pit_pass = ?").get(normalizePitPass(pitPass));
    const user = racer?.user_id ? this.accounts.user(racer.user_id) : null;
    if (!user) throw fail(404, "That pit-pass isn't anyone's. Check it, or ask the host.", "no_racer");
    return user;
  }

  // --- The race as it stands ----------------------------------------------------------------

  // { phase: lobby | countdown | racing | finished, startedAt, clockEndsAt, finishAt }, before the
  // racers are scored: finishAt is the clock's (or the host's End), not "everyone's home".
  timing(race) {
    const now = this.now();
    if (!race.started_at) return { phase: "lobby", startedAt: null, clockEndsAt: null, finishAt: null };
    const clockEndsAt = race.started_at + (race.duration_minutes + race.extra_minutes) * 60_000;
    const finishAt = Math.min(clockEndsAt, race.ended_at ?? Infinity);
    const phase = now < race.started_at ? "countdown" : now < finishAt ? "racing" : "finished";
    return { phase, startedAt: race.started_at, clockEndsAt, finishAt };
  }

  // The race for the screen (public), and for its racers' pills: who's where. `viewer`: the
  // signed-in user, so a racer finds themself (`me`).
  state(slugOrRace, { viewer = null, admin = false } = {}) {
    const race = typeof slugOrRace === "object" ? slugOrRace : this.bySlug(slugOrRace);
    const cached = this.cache.get(race.id);
    let state = cached && this.now() - cached.at < STATE_CACHE_MS ? cached.state : null;
    if (!state) {
      state = this.#compute(race);
      this.cache.set(race.id, { at: this.now(), state });
    }
    const me = viewer ? (state.racers.find((r) => r.userId === viewer)?.id ?? null) : null;
    const racers = state.racers.map(({ userId, pitPass, ...r }) => (admin ? { ...r, userId, pitPass, sandbox: userId ? (this.manager?.quickState?.(userId) ?? null) : null } : r));
    return { ...state, now: this.now(), me, racers };
  }

  // What a badge's medal needs (badgeArt.js), not the modules it's for.
  #badge(id) {
    const { modules, criteria, personas, ...badge } = this.course.badges[id] ?? { id, name: id, kind: "skill" };
    return badge;
  }

  #compute(race) {
    const now = this.now();
    const timing = this.timing(race);
    const rows = this.racers(race.id);
    const windowEnd = timing.startedAt ? Math.min(timing.finishAt, now) : null;
    const catalog = this.activity.catalog;
    let racers = rows.map((row, lane) => {
      let events = [];
      if (timing.startedAt && now >= timing.startedAt) {
        events = row.ghost
          ? ghostEvents(row, timing.startedAt, this.course).filter((e) => e.at <= windowEnd)
          : this.db.prepare("SELECT * FROM events WHERE user_id = ? AND at >= ? AND at <= ? ORDER BY at, id").all(row.user_id, timing.startedAt, windowEnd);
      }
      const score = scoreRacer(events, catalog, this.course);
      const sinceMove = now - (score.lastMoveAt ?? timing.startedAt ?? now);
      // On a module page (its heartbeat, once a minute while it's showing): reading, not grazing.
      const here = row.user_id ? this.activity.presence(row.user_id) : null;
      const present = Boolean(here && now - here.last_at < PRESENT_MS);
      return {
        id: row.id,
        userId: row.user_id,
        pitPass: row.pit_pass,
        lane,
        ghost: Boolean(row.ghost),
        name: row.name,
        horse: row.horse,
        creature: row.creature,
        silks: row.silks,
        pattern: row.pattern,
        coat: coatOf(row.id),
        joinedAt: row.created_at,
        ...score,
        grazing: timing.phase === "racing" && !score.finishedAt && !present && sinceMove >= (row.ghost ? GHOST_GRAZE_MS : GRAZE_MS),
      };
    });
    // Every stop done by everyone: nothing left to earn, so the race ends then.
    let finishAt = timing.finishAt;
    if (finishAt && racers.length && racers.every((r) => r.finishedAt)) finishAt = Math.min(finishAt, Math.max(...racers.map((r) => r.finishedAt)));
    const phase = !timing.startedAt ? "lobby" : now < timing.startedAt ? "countdown" : now < finishAt ? "racing" : "finished";
    if (phase === "finished") racers = racers.map((r) => ({ ...r, grazing: false }));
    const ranked = rank(racers);
    racers = racers.map((r) => ({ ...r, rank: ranked.indexOf(r) + 1 }));
    const badgeIds = new Set(racers.flatMap((r) => r.badges));
    return {
      race: {
        name: race.name,
        slug: race.slug,
        joinCode: race.join_code,
        phase,
        startedAt: timing.startedAt,
        clockEndsAt: timing.clockEndsAt,
        finishAt,
        podiumAt: phase === "finished" ? (race.podium_at ?? finishAt + PODIUM_DELAY_MS) : null,
        durationMinutes: race.duration_minutes,
        extraMinutes: race.extra_minutes,
        sound: Boolean(race.sound),
      },
      course: { stops: this.course.stops, maxXp: this.course.maxXp },
      badges: Object.fromEntries([...badgeIds].map((id) => [id, this.#badge(id)])),
      racers,
    };
  }
}
