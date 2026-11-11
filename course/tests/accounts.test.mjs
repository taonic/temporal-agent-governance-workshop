// Sign-in, the allowlist and cohorts, access requests, and the activity derived from events:
// against an in-memory database, with a clock the tests move.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { Accounts, ROLES, companyOf, isPersonalEmail, normalizeEmail, parseEntry } from "../runner/accounts.mjs";
import { Activity, catalogOf, deriveProgress } from "../runner/activity.mjs";
import { createAdmin, toCsv } from "../runner/admin.mjs";
import { e2eSignInCode } from "../runner/auth.mjs";
import { openDatabase } from "../runner/db.mjs";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const CATALOG = catalogOf({
  modules: [
    { id: "F1", kind: "module", xp: 10, title: "One", status: "ready" },
    { id: "F2", kind: "module", xp: 10, title: "Two", status: "ready" },
    { id: "FC1", kind: "challenge", xp: 20, title: "Challenge", status: "ready" },
  ],
  exercises: [{ challenges: { FC1: { choices: [{ id: "A" }, { id: "B", right: true }, { id: "C" }] } } }],
  paths: [
    { id: "event-4h", modules: ["F1", "FC1", "F2"], personas: ["developer"] },
    { id: "essentials", modules: [], personas: ["essentials"] },
  ],
  personas: [{ id: "developer" }, { id: "essentials" }],
});

function setup({ admins = ["boss@temporal.io"], consoleMode = false, e2eKey = "", adminSecretEmail = "" } = {}) {
  const clock = { now: Date.parse("2026-11-10T09:00:00Z") };
  const now = () => clock.now;
  const db = openDatabase(":memory:");
  const activity = new Activity(db, { catalog: CATALOG, now });
  const accounts = new Accounts(db, {
    secret: "test-secret",
    adminEmails: admins,
    adminSecretEmail,
    consoleSignIn: () => consoleMode,
    e2eKey,
    now,
    record: (...args) => activity.record(...args),
  });
  return { clock, db, accounts, activity };
}

// Signs an email in, as the page does: a code, then the code back.
function signIn(accounts, email, ip = "1.2.3.4") {
  const { code } = accounts.startSignIn(email, ip);
  return accounts.verifySignIn(email, code);
}

// --- Emails and the allowlist -----------------------------------------------------------------

test("emails are trimmed and lowercased, and junk isn't one", () => {
  assert.equal(normalizeEmail("  Jane.Doe@Acme.COM "), "jane.doe@acme.com");
  assert.equal(normalizeEmail("jane"), null);
  assert.equal(normalizeEmail("jane@localhost"), null);
  assert.equal(normalizeEmail("a b@acme.com"), null);
});

test("personal email domains are known, and a company is named from its domain", () => {
  assert.equal(isPersonalEmail("x@gmail.com"), true);
  assert.equal(isPersonalEmail("x@outlook.com"), true);
  assert.equal(isPersonalEmail("x@acme.com"), false);
  assert.equal(companyOf("x@acme.com"), "Acme");
  assert.equal(companyOf("x@mail.acme.co.uk"), "Acme");
  assert.equal(companyOf("x@eng.temporal.io"), "Temporal");
});

test("a pasted allowlist line is an email or a domain rule", () => {
  assert.deepEqual(parseEntry("Jane@Acme.com"), { kind: "email", value: "jane@acme.com" });
  assert.deepEqual(parseEntry("@acme.com"), { kind: "domain", value: "acme.com" });
  assert.deepEqual(parseEntry("acme.com"), { kind: "domain", value: "acme.com" });
  assert.deepEqual(parseEntry("<jane@acme.com>,"), { kind: "email", value: "jane@acme.com" });
  assert.equal(parseEntry("   "), null);
  assert.ok(parseEntry("not an entry").error);
});

test("an exact email, a domain rule and the admins are allowed; others aren't", () => {
  const { accounts } = setup();
  const sf = accounts.saveCohort({ name: "SF Nov 2026", path: "event-4h" }, "boss@temporal.io");
  const { added, invalid } = accounts.addEntries(sf.id, "jane@acme.com\n@globex.com\nnonsense", "boss@temporal.io");
  assert.equal(added.length, 2);
  assert.deepEqual(invalid, ["nonsense"]);
  assert.equal(accounts.accessFor("jane@acme.com").allowed, true);
  assert.equal(accounts.accessFor("jane@acme.com").cohort.name, "SF Nov 2026");
  assert.equal(accounts.accessFor("anyone@globex.com").allowed, true);
  assert.equal(accounts.accessFor("bob@acme.com").allowed, false);
  assert.equal(accounts.accessFor("boss@temporal.io").allowed, true);
});

test("an exact entry wins over a domain rule, so a learner can be moved to another cohort", () => {
  const { accounts } = setup();
  const a = accounts.saveCohort({ name: "A" }, "boss@temporal.io");
  const b = accounts.saveCohort({ name: "B" }, "boss@temporal.io");
  accounts.addEntries(a.id, "@acme.com", "boss@temporal.io");
  accounts.addEntries(b.id, "jane@acme.com", "boss@temporal.io");
  assert.equal(accounts.accessFor("jane@acme.com").cohort.name, "B");
  assert.equal(accounts.accessFor("bob@acme.com").cohort.name, "A");
});

test("a cohort past its end date lets nobody in", () => {
  const { accounts, clock } = setup();
  const sf = accounts.saveCohort({ name: "SF", endsAt: clock.now + DAY }, "boss@temporal.io");
  accounts.addEntries(sf.id, "jane@acme.com", "boss@temporal.io");
  assert.equal(accounts.accessFor("jane@acme.com").allowed, true);
  clock.now += 2 * DAY;
  assert.deepEqual([accounts.accessFor("jane@acme.com").allowed, accounts.accessFor("jane@acme.com").ended], [false, true]);
});

test("a local runner without email lets any email in", () => {
  const { accounts } = setup({ consoleMode: true });
  assert.equal(accounts.accessFor("anyone@acme.com").allowed, true);
  assert.equal(accounts.startSignIn("me@gmail.com", "127.0.0.1").delivery, "console");
});

// --- Sign-in codes ----------------------------------------------------------------------------

test("a code signs in once, and makes the user at the first sign-in", () => {
  const { accounts } = setup();
  const { code, delivery } = accounts.startSignIn(" Jane@Acme.com ", "1.2.3.4");
  assert.equal(delivery, "email");
  assert.match(code, /^\d{6}$/);
  const user = accounts.verifySignIn("jane@acme.com", code);
  assert.equal(user.email, "jane@acme.com");
  assert.equal(user.company, "Acme");
  assert.throws(() => accounts.verifySignIn("jane@acme.com", code), /expired/);
  assert.equal(signIn(accounts, "jane@acme.com").id, user.id, "the same user next time");
});

test("a code expires after 10 minutes", () => {
  const { accounts, clock } = setup();
  const { code } = accounts.startSignIn("jane@acme.com", "1.2.3.4");
  clock.now += 11 * MIN;
  assert.throws(() => accounts.verifySignIn("jane@acme.com", code), /expired/);
});

test("five wrong tries use a code up", () => {
  const { accounts } = setup();
  const { code } = accounts.startSignIn("jane@acme.com", "1.2.3.4");
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) assert.throws(() => accounts.verifySignIn("jane@acme.com", wrong), /isn't right/);
  assert.throws(() => accounts.verifySignIn("jane@acme.com", wrong), /Too many wrong tries/);
  assert.throws(() => accounts.verifySignIn("jane@acme.com", code), /expired/, "the right code no longer works either");
});

test("a new code replaces the last one", () => {
  const { accounts } = setup();
  const first = accounts.startSignIn("jane@acme.com", "1.2.3.4").code;
  const second = accounts.startSignIn("jane@acme.com", "1.2.3.4").code;
  if (first !== second) assert.throws(() => accounts.verifySignIn("jane@acme.com", first), /isn't right/);
  assert.ok(accounts.verifySignIn("jane@acme.com", second));
});

test("codes are limited to 3 per email and 10 per address in 15 minutes", () => {
  const { accounts, clock } = setup();
  for (let i = 0; i < 3; i++) accounts.startSignIn("jane@acme.com", "1.1.1.1");
  assert.throws(() => accounts.startSignIn("jane@acme.com", "1.1.1.1"), /Too many codes/);
  clock.now += 16 * MIN;
  assert.ok(accounts.startSignIn("jane@acme.com", "1.1.1.1"));
  for (let i = 0; i < 10; i++) accounts.startSignIn(`p${i}@acme.com`, "2.2.2.2");
  assert.throws(() => accounts.startSignIn("p10@acme.com", "2.2.2.2"), /Too many codes/);
});

test("wrong codes are limited per email, however many new codes are asked for", () => {
  const { accounts } = setup({ e2eKey: "k" });
  const email = "e2e+brute@temporalquest.dev";
  const right = e2eSignInCode("k", email);
  const wrong = right === "000000" ? "111111" : "000000";
  // An e2e address may ask for as many codes as it likes (no email is sent)...
  for (let i = 0; i < 5; i++) {
    accounts.startSignIn(email, "1.2.3.4");
    assert.throws(() => accounts.verifySignIn(email, wrong), /isn't right/);
    assert.throws(() => accounts.verifySignIn(email, wrong), /isn't right|Too many/);
  }
  // ...but after 10 wrong codes, even the right one waits.
  accounts.startSignIn(email, "1.2.3.4");
  assert.throws(() => accounts.verifySignIn(email, right), /Too many wrong codes/);
});

test("a personal email is asked for a company one, unless it's listed exactly", () => {
  const { accounts } = setup();
  assert.throws(() => accounts.startSignIn("jane@gmail.com", "1.2.3.4"), (err) => err.code === "personal_email");
  const sf = accounts.saveCohort({ name: "SF" }, "boss@temporal.io");
  accounts.addEntries(sf.id, "jane@gmail.com", "boss@temporal.io");
  assert.ok(accounts.startSignIn("jane@gmail.com", "1.2.3.4"));
  assert.equal(accounts.accessFor("jane@gmail.com").allowed, true);
});

test("an e2e address's code is derived from the key, and no email is sent", () => {
  const { accounts } = setup({ e2eKey: "k" });
  const { delivery } = accounts.startSignIn("e2e+run1@temporalquest.dev", "1.2.3.4");
  assert.equal(delivery, "none");
  assert.ok(accounts.verifySignIn("e2e+run1@temporalquest.dev", e2eSignInCode("k", "e2e+run1@temporalquest.dev")));
  // Without the key, an e2e address is an ordinary one.
  assert.equal(setup().accounts.startSignIn("e2e+run1@temporalquest.dev", "1.2.3.4").delivery, "email");
});

test("a blocked user can't sign in, and their session ends", () => {
  const { accounts } = setup();
  const sf = accounts.saveCohort({ name: "SF" }, "boss@temporal.io");
  accounts.addEntries(sf.id, "jane@acme.com", "boss@temporal.io");
  const user = signIn(accounts, "jane@acme.com");
  assert.ok(accounts.sessionUser(user.id));
  accounts.setStatus(user.id, "blocked", "boss@temporal.io");
  assert.equal(accounts.sessionUser(user.id), null);
  assert.throws(() => signIn(accounts, "jane@acme.com"), /blocked/);
});

test("removing someone from the allowlist takes their access away", () => {
  const { accounts } = setup();
  const sf = accounts.saveCohort({ name: "SF" }, "boss@temporal.io");
  accounts.addEntries(sf.id, "jane@acme.com", "boss@temporal.io");
  const user = signIn(accounts, "jane@acme.com");
  assert.equal(accounts.sessionUser(user.id).access.allowed, true);
  accounts.removeEntry(accounts.entries(sf.id)[0].id, "boss@temporal.io");
  assert.equal(accounts.sessionUser(user.id).access.allowed, false);
});

// --- Profiles and access requests -------------------------------------------------------------

test("everyone gives a name and a role; a role must be one of the list", () => {
  const { accounts } = setup();
  const user = signIn(accounts, "boss@temporal.io");
  assert.equal(accounts.describe(accounts.sessionUser(user.id)).needsProfile, true);
  assert.throws(() => accounts.setProfile(user.id, { name: "Boss", role: "Wizard" }), /role/);
  assert.throws(() => accounts.setProfile(user.id, { name: "  ", role: "Developer" }), /name/);
  const { requested } = accounts.setProfile(user.id, { name: "  The   Boss ", role: "Developer" });
  assert.equal(requested, null, "an admin files no request");
  const described = accounts.describe(accounts.sessionUser(user.id));
  assert.deepEqual([described.name, described.needsProfile, described.admin], ["The Boss", false, true]);
});

test("an unlisted company email files a request with its profile, once", () => {
  const { accounts } = setup();
  const user = signIn(accounts, "jane@acme.com");
  const { requested } = accounts.setProfile(user.id, { name: "Jane", role: "Architect" });
  assert.equal(requested.email, "jane@acme.com");
  assert.equal(accounts.describe(accounts.sessionUser(user.id)).request.status, "pending");
  assert.equal(accounts.setProfile(user.id, { name: "Jane D", role: "Architect" }).requested, null, "no second request");
  assert.equal(accounts.requests({ status: "pending" }).length, 1);
});

test("approving the email lets in that email only, in the On-demand cohort", () => {
  const { accounts } = setup();
  const user = signIn(accounts, "jane@acme.com");
  const { requested } = accounts.setProfile(user.id, { name: "Jane", role: "Architect" });
  const decided = accounts.decide(requested.id, { approve: true, scope: "email" }, "boss@temporal.io");
  assert.equal(decided.status, "approved");
  assert.equal(accounts.accessFor("jane@acme.com").allowed, true);
  assert.equal(accounts.accessFor("jane@acme.com").cohort.name, "On-demand");
  assert.equal(accounts.accessFor("bob@acme.com").allowed, false);
  assert.throws(() => accounts.decide(requested.id, { approve: false }, "boss@temporal.io"), /already been decided/);
});

test("approving the domain lets in everyone at it", () => {
  const { accounts } = setup();
  const user = signIn(accounts, "jane@acme.com");
  const { requested } = accounts.setProfile(user.id, { name: "Jane", role: "Architect" });
  accounts.decide(requested.id, { approve: true, scope: "domain" }, "boss@temporal.io");
  assert.equal(accounts.accessFor("bob@acme.com").allowed, true);
});

test("a rejected request keeps its reason, and isn't filed again", () => {
  const { accounts } = setup();
  const user = signIn(accounts, "jane@acme.com");
  const { requested } = accounts.setProfile(user.id, { name: "Jane", role: "Architect" });
  accounts.decide(requested.id, { approve: false, reason: "Not a customer yet" }, "boss@temporal.io");
  const described = accounts.describe(accounts.sessionUser(user.id));
  assert.deepEqual([described.allowed, described.request.status, described.request.reason], [false, "rejected", "Not a customer yet"]);
  assert.equal(accounts.setProfile(user.id, { name: "Jane", role: "Architect" }).requested, null);
});

test("deleting a learner removes them, their events and their exact entry", () => {
  const { accounts, activity, db } = setup();
  const sf = accounts.saveCohort({ name: "SF" }, "boss@temporal.io");
  accounts.addEntries(sf.id, "jane@acme.com", "boss@temporal.io");
  const user = signIn(accounts, "jane@acme.com");
  activity.record(user.id, "module_passed", "F1");
  activity.heartbeat(user.id, "F1");
  accounts.deleteUser(user.id, "boss@temporal.io");
  assert.equal(accounts.user(user.id), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ?").get(user.id).n, 0);
  assert.equal(accounts.entries(sf.id).length, 0);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM events").all()).includes("jane@acme.com"), false, "the log doesn't keep the email");
});

test("the built-in On-demand cohort keeps its name and never ends", () => {
  const { accounts, clock } = setup();
  const onDemand = accounts.cohorts().find((c) => c.builtin);
  accounts.saveCohort({ id: onDemand.id, name: "Renamed", endsAt: clock.now - 1, allowanceMinutes: 120 }, "boss@temporal.io");
  const after = accounts.cohorts().find((c) => c.builtin);
  assert.deepEqual([after.name, after.endsAt, after.allowanceMinutes, after.active], ["On-demand", null, 120, true]);
});

// --- Progress, presence and sandbox time -------------------------------------------------------

test("progress comes from the events: passes in order, challenge picks, the path", () => {
  const events = [
    { type: "module_passed", module_id: "F1" },
    { type: "challenge_pick", module_id: "FC1", data: JSON.stringify({ choice: "A" }) },
    { type: "challenge_pick", module_id: "FC1", data: JSON.stringify({ choice: "A" }) },
    { type: "challenge_pick", module_id: "FC1", data: JSON.stringify({ choice: "B" }) },
    { type: "challenge_pick", module_id: "FC1", data: JSON.stringify({ choice: "C" }) },
    { type: "module_passed", module_id: "FC1" },
    { type: "module_passed", module_id: "F1" },
    { type: "path_set", data: JSON.stringify({ path: "event-4h" }) },
  ];
  const progress = deriveProgress(events, CATALOG);
  assert.deepEqual(progress.completed, ["F1", "FC1"]);
  assert.deepEqual(progress.attempts, { FC1: ["A", "B"] });
  assert.equal(progress.path, "event-4h");
  assert.equal(progress.xp, 10 + 10, "F1, and FC1 on the second pick");
});

test("the page's events are checked: unknown types and modules are dropped", () => {
  const { accounts, activity } = setup();
  const user = signIn(accounts, "boss@temporal.io");
  const recorded = activity.recordFromBrowser(user.id, [
    { type: "module_passed", moduleId: "F1" },
    { type: "module_passed", moduleId: "NOPE" },
    { type: "sign_in" },
    { type: "challenge_pick", moduleId: "FC1", data: { choice: "B" } },
    { type: "path_set", data: { path: "event-4h" } },
    { type: "path_set", data: { path: "no-such-path" } },
  ]);
  assert.equal(recorded, 3);
  assert.deepEqual(activity.progress(user.id).completed, ["F1"]);
});

test("a learner's path is the one they picked, else their cohort's", () => {
  const { accounts, activity } = setup();
  const user = signIn(accounts, "boss@temporal.io");
  assert.equal(activity.progress(user.id, "event-4h").path, "event-4h");
  activity.recordFromBrowser(user.id, [{ type: "path_set", data: { path: null } }]);
  assert.equal(activity.progress(user.id, "event-4h").path, null);
});

test("this browser's progress is imported at the first sign-in, once", () => {
  const { accounts, activity } = setup();
  const user = signIn(accounts, "boss@temporal.io");
  activity.record(user.id, "module_passed", "F2");
  assert.equal(activity.importProgress(user.id, { completed: ["F1", "F2", "BOGUS"], attempts: { FC1: ["A", "B"] }, path: "event-4h" }), true);
  const progress = activity.progress(user.id);
  assert.deepEqual(progress.completed.sort(), ["F1", "F2"]);
  assert.deepEqual(progress.attempts, { FC1: ["A", "B"] });
  assert.equal(progress.path, "event-4h");
  assert.equal(activity.importProgress(user.id, { completed: ["FC1"] }), false);
  assert.deepEqual(activity.progress(user.id).completed.sort(), ["F1", "F2"]);
});

test("heartbeats measure time on a module without adding events, and spot a learner who's stuck", () => {
  const { accounts, activity, clock, db } = setup();
  const user = signIn(accounts, "boss@temporal.io");
  const events = () => db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  const before = events();
  activity.heartbeat(user.id, "F1");
  for (let i = 0; i < 11; i++) {
    clock.now += MIN;
    activity.heartbeat(user.id, "F1");
  }
  assert.equal(events(), before, "heartbeats aren't events");
  assert.equal(activity.moduleTimes(user.id).F1, 11 * 60);
  assert.deepEqual(activity.whereIs(user.id, []), { moduleId: "F1", minutes: 11, lastAt: clock.now, active: true, stuck: true });
  assert.equal(activity.whereIs(user.id, ["F1"]).stuck, false, "not once it's passed");
  clock.now += 10 * MIN;
  assert.equal(activity.whereIs(user.id, []).stuck, false, "not once they've gone (no heartbeat)");
  // A long gap (a hidden tab, lunch) counts as at most 90 seconds.
  activity.heartbeat(user.id, "F1");
  assert.equal(activity.moduleTimes(user.id).F1, 11 * 60 + 90);
  activity.heartbeat(user.id, "F2");
  assert.equal(activity.whereIs(user.id, []).moduleId, "F2");
  assert.equal(activity.whereIs(user.id, []).minutes, 0);
});

test("sandbox time is summed over a rolling 24 hours, and frees up as it rolls out", () => {
  const { activity, clock } = setup();
  const start = clock.now;
  // 8 hours, a minute at a time, from 09:00.
  for (let i = 0; i < 480; i++) activity.countSandboxMinute("u1", start + i * MIN);
  clock.now = start + 480 * MIN;
  const out = activity.allowance("u1", 480);
  assert.deepEqual([out.usedMinutes, out.remainingMinutes], [480, 0]);
  // The first minute (09:00) rolls out at 09:00 the next day.
  assert.equal(out.freesAt, start + DAY);
  clock.now = start + DAY;
  assert.deepEqual([activity.allowance("u1", 480).usedMinutes, activity.allowance("u1", 480).remainingMinutes], [479, 1]);
  // A bigger allowance frees it at once.
  clock.now = start + 480 * MIN;
  assert.equal(activity.allowance("u1", 600).remainingMinutes, 120);
  // Counting the same minute twice counts it once.
  activity.countSandboxMinute("u1", start);
  assert.equal(activity.allowance("u1", 600).usedMinutes, 480);
});

test("a sandbox that spans the window's edge counts only its minutes inside the window", () => {
  const { activity, clock } = setup();
  const start = clock.now;
  for (let i = 0; i < 120; i++) activity.countSandboxMinute("u1", start + i * MIN); // 09:00–11:00
  clock.now = start + DAY + 60 * MIN; // 10:00 the next day: 10:00's minute has just rolled out
  assert.equal(activity.allowance("u1", 480).usedMinutes, 59);
});

test("model calls are written as one event per learner per flush", () => {
  const { activity, db } = setup();
  activity.countModelCall("u1");
  activity.countModelCall("u1");
  activity.countModelCall("u2");
  activity.flushModelCalls();
  activity.flushModelCalls();
  const rows = db.prepare("SELECT user_id, data FROM events WHERE type = 'model_calls' ORDER BY user_id").all();
  assert.deepEqual(rows.map((r) => [r.user_id, JSON.parse(r.data).count]), [["u1", 2], ["u2", 1]]);
});

test("CSV cells with commas, quotes and newlines are quoted", () => {
  assert.equal(toCsv([["a", 'say "hi"', "x,y", null], ["line\nbreak"]]), 'a,"say ""hi""","x,y",\r\n"line\nbreak"\r\n');
});

// --- The sweep: sandbox time, lifecycle events, the allowance -----------------------------------

test("the sweep counts running sandboxes' minutes, records their starts and stops, and stops one out of time", async () => {
  const { createSweep } = await import("../runner/sweep.mjs");
  const { accounts, activity, clock, db } = setup();
  const sf = accounts.saveCohort({ name: "SF", allowanceMinutes: 3 }, "boss@temporal.io");
  accounts.addEntries(sf.id, "jane@acme.com", "boss@temporal.io");
  const jane = signIn(accounts, "jane@acme.com");
  const sandboxes = [{ learner: jane.id, state: "stopped" }];
  const stopped = [];
  const manager = { listAll: async () => sandboxes, stop: async (id) => stopped.push(id) };
  const sweep = createSweep({ manager, accounts, activity });
  const types = () => db.prepare("SELECT type FROM events WHERE user_id = ? AND type LIKE 'sandbox_%' OR type = 'allowance_reached' ORDER BY id").all(jane.id).map((r) => r.type);

  await sweep.tick(); // the first sweep only learns the states
  sandboxes[0].state = "started";
  for (let i = 0; i < 2; i++) {
    clock.now += MIN;
    await sweep.tick();
  }
  assert.deepEqual(types(), ["sandbox_started"]);
  assert.equal(activity.allowance(jane.id, 3).usedMinutes, 2);
  assert.deepEqual(stopped, []);
  clock.now += MIN;
  await sweep.tick(); // the third minute: the cohort's 3 are used
  assert.deepEqual(stopped, [jane.id]);
  assert.ok(types().includes("allowance_reached"));
  sandboxes[0].state = "stopped";
  clock.now += MIN;
  await sweep.tick();
  sandboxes.length = 0;
  clock.now += MIN;
  await sweep.tick();
  assert.deepEqual(types().filter((t) => t !== "allowance_reached"), ["sandbox_started", "sandbox_stopped", "sandbox_gone"]);
});

test("a learner's persona is the one they chose last, else their cohort's path's, else none", () => {
  const { accounts, activity } = setup();
  const user = signIn(accounts, "boss@temporal.io");
  assert.equal(activity.progress(user.id).persona, null);
  assert.equal(activity.progress(user.id, "essentials").persona, "essentials");
  const recorded = activity.recordFromBrowser(user.id, [
    { type: "persona_set", data: { persona: "essentials" } },
    { type: "persona_set", data: { persona: "nobody" } },
    { type: "persona_set", data: { persona: "developer" } },
  ]);
  assert.equal(recorded, 2, "an unknown persona is dropped");
  assert.equal(activity.progress(user.id).persona, "developer");
  assert.equal(activity.progress(user.id, "essentials").persona, "developer", "a choice beats the cohort's");
});

test("admins see each learner's persona, how many learn as each, and can list one persona's", async () => {
  const { accounts, activity, clock } = setup({ admins: ["boss@temporal.io", "pm@temporal.io", "dev@temporal.io"] });
  const pm = signIn(accounts, "pm@temporal.io");
  const dev = signIn(accounts, "dev@temporal.io");
  activity.recordFromBrowser(pm.id, [{ type: "persona_set", data: { persona: "developer" } }]);
  clock.now += 60_000;
  activity.recordFromBrowser(pm.id, [{ type: "persona_set", data: { persona: "essentials" } }]);
  activity.recordFromBrowser(dev.id, [{ type: "persona_set", data: { persona: "developer" } }]);
  const admin = createAdmin({ accounts, activity, sessionOf: () => ({ admin: true, email: "boss@temporal.io" }) });
  const get = (route, query = "") => admin.routes[route]({}, {}, new URL(`http://x/?${query}`));

  const all = await get("GET /api/admin/learners");
  assert.equal(all.learners.find((l) => l.id === pm.id).persona, "essentials");
  assert.equal(all.learners.find((l) => l.id === dev.id).persona, "developer");
  assert.equal(all.summary.personas.essentials, 1);
  assert.equal(all.summary.personas.developer, 1);
  const onlyEssentials = await get("GET /api/admin/learners", "persona=essentials");
  assert.deepEqual(onlyEssentials.learners.map((l) => l.id), [pm.id]);
  assert.equal(onlyEssentials.summary.learners, 1);
  assert.equal(onlyEssentials.summary.personas.developer, 1, "the counts are everyone's, to filter by");

  const journey = await get("GET /api/admin/learner", `id=${pm.id}`);
  assert.equal(journey.persona, "essentials");
  assert.deepEqual(journey.personaChanges.map((c) => c.persona), ["developer", "essentials"]);
  assert.ok(journey.personaChanges[1].at > journey.personaChanges[0].at);
});

test("the sign-in form offers the roles the runner accepts, product owners among them", () => {
  const form = fs.readFileSync(new URL("../web/src/components/AccessForm.vue", import.meta.url), "utf8").match(/^const ROLES = (\[.*\]);$/m)[1];
  assert.deepEqual(JSON.parse(form), ROLES);
  assert.ok(ROLES.includes("Product owner"));
});

test("the secret admin address signs in at once, as an admin, with no code; no other address does", () => {
  const secretEmail = "admin-k3x9q2v7@temporalquest.dev";
  const { accounts } = setup({ adminSecretEmail: secretEmail });
  const user = accounts.secretAdmin(" Admin-K3X9Q2V7@temporalquest.dev ", "1.2.3.4");
  assert.equal(user.email, secretEmail);
  const session = accounts.sessionUser(user.id);
  assert.equal(session.admin, true);
  assert.equal(session.access.allowed, true);
  assert.equal(accounts.describe(session).needsProfile, false, "nothing more is asked");
  assert.equal(accounts.secretAdmin(secretEmail, "1.2.3.4").id, user.id, "the same user the next time");
  assert.equal(accounts.secretAdmin("admin-k3x9q2v8@temporalquest.dev", "1.2.3.4"), null);
  assert.equal(accounts.secretAdmin("boss@temporal.io", "1.2.3.4"), null, "an ordinary admin still gets a code");
  assert.equal(setup().accounts.secretAdmin("", "1.2.3.4"), null, "unset, nobody is the secret admin");
  for (let i = 0; i < 30; i++) accounts.secretAdmin(secretEmail, "1.2.3.4");
  assert.equal(accounts.secretAdmin(secretEmail, "1.2.3.4").id, user.id, "signing in with it often isn't limited (the e2e tests do)");
});
