// The Derby (runner/race.mjs): making races, joining without an email, scoring (XP, then who got
// there first), the race's phases and the host's controls, and ghosts. Against an in-memory
// database, with a clock the tests move.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Accounts } from "../runner/accounts.mjs";
import { Activity, catalogOf } from "../runner/activity.mjs";
import { openDatabase } from "../runner/db.mjs";
import { COUNTDOWN_MS, GRAZE_MS, PODIUM_DELAY_MS, Races, ghostEvents, raceCourse } from "../runner/race.mjs";

const MIN = 60_000;

// A small Essentials: two modules, a challenge, a boss.
const DATA = {
  branches: [{ id: "essentials", modules: ["E1", "EC1", "E2"], boss: "E-boss", personas: ["essentials"] }],
  modules: [
    { id: "E1", kind: "module", xp: 10, title: "Meet the coordinator", emoji: "📒", status: "ready", branch: "essentials" },
    { id: "EC1", kind: "challenge", xp: 20, title: "A bad minute", status: "ready", branch: "essentials" },
    { id: "E2", kind: "module", xp: 10, title: "A mistake pauses", emoji: "🐞", status: "ready", branch: "essentials" },
    { id: "E-boss", kind: "boss", xp: 50, title: "The Night Shift", status: "ready", branch: "essentials" },
  ],
  exercises: [{ challenges: { EC1: { choices: [{ id: "A" }, { id: "B", right: true }, { id: "C" }] } } }],
  paths: [{ id: "essentials", modules: ["E1", "EC1", "E2"], personas: ["essentials"] }],
  personas: [{ id: "developer" }, { id: "essentials" }],
  badges: [],
};

function setup() {
  const clock = { now: Date.parse("2026-11-20T09:00:00Z") };
  const now = () => clock.now;
  const db = openDatabase(":memory:");
  const activity = new Activity(db, { catalog: catalogOf(DATA), now });
  const accounts = new Accounts(db, { secret: "s", adminEmails: ["host@temporal.io"], now, record: (...a) => activity.record(...a) });
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const races = new Races(db, { accounts, activity, course: raceCourse(DATA), now, random });
  return { clock, db, accounts, activity, races };
}

const jockey = (name, silks, extra = {}) => ({ name, horse: `${name}'s horse`, creature: "gecko", silks, pattern: "hoops", ...extra });

test("the course: Essentials' stops in order, each post at the XP of a clean run to it", () => {
  const course = raceCourse(DATA);
  assert.deepEqual(course.stops.map((s) => [s.id, s.at]), [["E1", 10], ["EC1", 30], ["E2", 40], ["E-boss", 90]]);
  assert.equal(course.maxXp, 90);
  assert.equal(course.bossId, "E-boss");
});

test("a race gets a cohort of its own on the Essentials path, kept out of the cohorts list", () => {
  const { races, accounts } = setup();
  const race = races.create({ name: "Phuket Derby", joinCode: "derby42" });
  assert.equal(race.joinCode, "DERBY42");
  assert.equal(race.slug, "phuket-derby");
  assert.equal(races.create({ name: "Phuket Derby" }).slug, "phuket-derby-2");
  assert.ok(!accounts.cohorts().some((c) => c.id === race.cohortId));
  assert.throws(() => races.create({ name: "Other", joinCode: "DERBY42" }), /already uses/);
});

test("joining: no email, a user in the race's cohort, allowed, with a pit-pass that signs back in", () => {
  const { races, accounts } = setup();
  races.create({ name: "Derby", joinCode: "DERBY42" });
  const { user, racer } = races.join("derby 42", jockey("Tao", "scarlet"));
  assert.match(user.email, /^racer-[0-9a-f]+@derby\.invalid$/);
  assert.equal(user.name, "Tao");
  const session = accounts.sessionUser(user.id);
  assert.equal(session.access.allowed, true);
  assert.equal(session.access.cohort.path, "essentials");
  assert.ok(user.imported_at, "a racer's browser progress is never imported");
  assert.equal(races.resume(racer.pit_pass.toUpperCase()).id, user.id);
  assert.equal(races.describeRacer(user.id).raceName, "Derby");
});

test("joining: names are unique (any case), each colour is taken once, and the code must exist", () => {
  const { races } = setup();
  races.create({ name: "Derby", joinCode: "DERBY42" });
  races.join("DERBY42", jockey("Tao", "scarlet"));
  assert.throws(() => races.join("DERBY42", jockey("tao", "sky")), /already a tao/);
  assert.throws(() => races.join("DERBY42", jockey("Ana", "scarlet")), /took that colour/);
  assert.throws(() => races.join("NOPE99", jockey("Ana", "sky")), /isn't a race/);
  assert.throws(() => races.join("DERBY42", jockey("Ana", "sky", { creature: "dragon" })), /Pick a jockey/);
  assert.deepEqual(races.joinInfo("DERBY42").takenSilks, ["scarlet"]);
});

test("phases: lobby, a countdown to the gun, racing, finished at the clock; access lasts a day after", () => {
  const { races, clock, db } = setup();
  const { id } = races.create({ name: "Derby", joinCode: "DERBY42", durationMinutes: 30 });
  races.join("DERBY42", jockey("Tao", "scarlet"));
  assert.equal(races.state("derby").race.phase, "lobby");
  races.act(id, "start");
  assert.equal(races.state("derby").race.phase, "countdown");
  clock.now += COUNTDOWN_MS;
  assert.equal(races.state("derby").race.phase, "racing");
  const { cohort_id: cohortId } = races.race(id);
  const cohort = db.prepare("SELECT ends_at FROM cohorts WHERE id = ?").get(cohortId);
  assert.equal(cohort.ends_at, races.race(id).started_at + 30 * MIN + 24 * 60 * MIN);
  races.act(id, "extend");
  clock.now += 31 * MIN;
  assert.equal(races.state("derby").race.phase, "racing", "+5 minutes");
  clock.now += 5 * MIN;
  const done = races.state("derby").race;
  assert.equal(done.phase, "finished");
  assert.equal(done.podiumAt, done.finishAt + PODIUM_DELAY_MS);
  assert.throws(() => races.join("DERBY42", jockey("Late", "sky")), /over/);
});

test("scoring: XP from the gun to the finish, ties go to whoever got there first, wrong picks stumble", () => {
  const { races, clock, activity } = setup();
  const { id } = races.create({ name: "Derby", joinCode: "DERBY42" });
  const a = races.join("DERBY42", jockey("Ana", "scarlet")).user.id;
  const b = races.join("DERBY42", jockey("Ben", "sky")).user.id;
  const c = races.join("DERBY42", jockey("Cy", "lime")).user.id;
  activity.record(a, "module_passed", "E1"); // before the gun: doesn't count
  races.act(id, "start");
  clock.now += COUNTDOWN_MS + 1000;
  activity.record(b, "module_passed", "E1");
  clock.now += 1000;
  activity.record(a, "module_passed", "E1"); // her pass before the gun didn't count: this one does
  activity.record(c, "module_passed", "E1");
  clock.now += 1000;
  activity.record(c, "challenge_pick", "EC1", { choice: "A" });
  activity.record(c, "challenge_pick", "EC1", { choice: "B" });
  activity.record(c, "module_passed", "EC1");
  clock.now += 1000;
  const state = races.state("derby");
  const by = Object.fromEntries(state.racers.map((r) => [r.name, r]));
  assert.equal(by.Cy.xp, 20, "10 for E1, 10 for EC1 on the second pick");
  assert.equal(by.Cy.stumbles, 1);
  assert.equal(by.Cy.rank, 1);
  assert.equal(by.Ben.xp, 10);
  assert.equal(by.Ben.rank, 2, "Ben reached 10 XP first");
  assert.equal(by.Ana.xp, 10);
  assert.equal(by.Ana.rank, 3, "Ana reached 10 XP after Ben");
  assert.equal(state.racers[0].userId, undefined, "the public state has no user ids");
  assert.equal(state.racers[0].pitPass, undefined, "nor pit-passes");
});

test("everyone home ends the race; the host can end it and reveal the podium", () => {
  const { races, clock, activity } = setup();
  const { id } = races.create({ name: "Derby", joinCode: "DERBY42" });
  const a = races.join("DERBY42", jockey("Ana", "scarlet")).user.id;
  races.act(id, "start");
  clock.now += COUNTDOWN_MS + 1000;
  activity.record(a, "boss_result", "E-boss", { won: false, hearts: 0 });
  clock.now += 1000;
  activity.record(a, "boss_result", "E-boss", { won: true, hearts: 3 });
  activity.record(a, "module_passed", "E-boss");
  clock.now += 1000;
  const state = races.state("derby");
  assert.equal(state.race.phase, "finished");
  assert.equal(state.racers[0].finishedAt, clock.now - 1000);
  assert.equal(state.racers[0].stumbles, 1, "a lost boss stumbles");
  races.act(id, "podium");
  clock.now += 1000;
  assert.ok(races.state("derby").race.podiumAt < clock.now);
});

test("a racer with no progress for eight minutes grazes", () => {
  const { races, clock } = setup();
  const { id } = races.create({ name: "Derby", joinCode: "DERBY42" });
  races.join("DERBY42", jockey("Ana", "scarlet"));
  races.act(id, "start");
  clock.now += COUNTDOWN_MS + GRAZE_MS - 1000;
  assert.equal(races.state("derby").racers[0].grazing, false);
  clock.now += 2000;
  assert.equal(races.state("derby").racers[0].grazing, true);
});

test("ghosts fill the field before the start and run the whole course, a twin a second behind", () => {
  const { races, clock } = setup();
  const { id } = races.create({ name: "Derby", joinCode: "DERBY42" });
  races.join("DERBY42", jockey("Tao", "scarlet"));
  assert.equal(races.fillGhosts(id), 15);
  const lobby = races.state("derby");
  assert.equal(new Set(lobby.racers.map((r) => r.silks)).size, 15, "every lane its own colour");
  races.act(id, "start");
  assert.throws(() => races.fillGhosts(id), /before the start/);
  clock.now += COUNTDOWN_MS + 20 * MIN;
  const state = races.state("derby");
  const ghosts = state.racers.filter((r) => r.ghost);
  assert.ok(ghosts.every((g) => g.finishedAt), "every ghost finishes within 20 minutes");
  const [first, twin] = races.racers(id).filter((r) => r.ghost);
  const course = raceCourse(DATA);
  const lastOf = (r) => ghostEvents(r, 0, course).at(-1).at;
  assert.equal(lastOf(twin) - lastOf(first), 1200);
});

test("reset clears the field and their accounts; removing a racer frees their colour", () => {
  const { races, accounts, clock } = setup();
  const { id } = races.create({ name: "Derby", joinCode: "DERBY42" });
  const { user, racer } = races.join("DERBY42", jockey("Ana", "scarlet"));
  races.removeRacer(racer.id);
  assert.equal(accounts.user(user.id), null);
  races.join("DERBY42", jockey("Ben", "scarlet"));
  races.renameRacer(races.racers(id)[0].id, "Benji");
  assert.equal(races.racers(id)[0].name, "Benji");
  races.act(id, "start");
  clock.now += COUNTDOWN_MS;
  races.reset(id);
  assert.equal(races.racers(id).length, 0);
  assert.equal(races.state("derby").race.phase, "lobby");
  races.remove(id);
  assert.throws(() => races.race(id), /No such race/);
});
