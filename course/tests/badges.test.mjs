// Badges: the rules (web/src/badges.js), the content that defines them (build.mjs), and how the
// server keeps them (runner/activity.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";

import { ICON_NAMES, medalSvg } from "../web/src/badgeArt.js";
import { badgeContext, earnedNow, isComingSoon, meets, missingFor } from "../web/src/badges.js";
import { CLASS_TITLE_MAX, idList, loadBadges, loadQuests } from "../content/build.mjs";
import { Activity, catalogOf, deriveProgress } from "../runner/activity.mjs";
import { openDatabase } from "../runner/db.mjs";

const MODULES = [
  { id: "F1", kind: "module", branch: "fundamentals", tier: 1, status: "ready", xp: 10 },
  { id: "F2", kind: "module", branch: "fundamentals", tier: 1, status: "ready", xp: 10 },
  { id: "FC1", kind: "challenge", branch: "fundamentals", tier: 1, status: "ready", xp: 20 },
  { id: "F3", kind: "module", branch: "fundamentals", tier: 2, status: "coming-soon", xp: 10 },
  { id: "F-boss", kind: "boss", branch: "fundamentals", status: "ready", xp: 50 },
  { id: "A1", kind: "module", branch: "ai-agent", tier: 1, status: "ready", xp: 10 },
  { id: "P1", kind: "module", branch: "payments", tier: 1, status: "coming-soon", xp: 10 },
];
const BADGES = [
  { id: "fundamentals-1", kind: "tier", modules: ["F1", "F2", "FC1"] },
  { id: "fundamentals-2", kind: "tier", modules: ["F3"] },
  { id: "fundamentals-boss", kind: "boss", module: "F-boss" },
  { id: "clean-run", kind: "skill", rule: "clean-run" },
  { id: "no-peeking", kind: "skill", rule: "no-peeking" },
  { id: "flawless", kind: "skill", rule: "flawless" },
  { id: "explorer", kind: "skill", rule: "explorer" },
  { id: "cross-team", kind: "skill", rule: "pass", module: "A1" },
];
const RIGHT = { FC1: "B" };
const ctx = badgeContext(MODULES, (id) => RIGHT[id] ?? null);
const badge = (id) => BADGES.find((b) => b.id === id);
const state = (over = {}) => ({ completed: [], attempts: {}, solutionUsed: [], bossResults: [], ...over });

test("a tier badge needs every ready module and challenge in it", () => {
  assert.equal(meets(badge("fundamentals-1"), ctx, state({ completed: ["F1", "F2"] })), false);
  assert.equal(meets(badge("fundamentals-1"), ctx, state({ completed: ["F1", "F2", "FC1"] })), true);
  // A tier whose modules are all coming soon can't be earned yet.
  assert.equal(meets(badge("fundamentals-2"), ctx, state({ completed: ["F3"] })), false);
  assert.equal(isComingSoon(badge("fundamentals-2"), ctx), true);
  assert.equal(isComingSoon(badge("fundamentals-1"), ctx), false);
});

test("a tier that grows shows what's new on its badge", () => {
  const grown = badgeContext(MODULES.map((m) => (m.id === "F3" ? { ...m, tier: 1, status: "ready" } : m)), () => null);
  const tier = { ...badge("fundamentals-1"), modules: ["F1", "F2", "FC1", "F3"] };
  assert.deepEqual(missingFor(tier, grown, ["F1", "F2", "FC1"]), ["F3"]);
});

test("a boss badge is its boss beaten; Cross-Team is its module passed", () => {
  assert.equal(meets(badge("fundamentals-boss"), ctx, state({ completed: ["F-boss"] })), true);
  assert.equal(meets(badge("cross-team"), ctx, state({ completed: ["F1"] })), false);
  assert.equal(meets(badge("cross-team"), ctx, state({ completed: ["A1"] })), true);
});

test("Clean Run: every challenge in a branch right on the first pick", () => {
  assert.equal(meets(badge("clean-run"), ctx, state({ attempts: { FC1: ["B"] } })), true);
  assert.equal(meets(badge("clean-run"), ctx, state({ attempts: { FC1: ["A", "B"] } })), false);
  // A test-out passes the challenge with no picks: it doesn't count.
  assert.equal(meets(badge("clean-run"), ctx, state({ completed: ["FC1"] })), false);
});

test("No Peeking: a branch's ready modules all passed, none with the solution", () => {
  const all = ["F1", "F2", "FC1"];
  assert.equal(meets(badge("no-peeking"), ctx, state({ completed: all })), true);
  assert.equal(meets(badge("no-peeking"), ctx, state({ completed: all, solutionUsed: ["F2"] })), false);
  assert.equal(meets(badge("no-peeking"), ctx, state({ completed: ["A1"] })), true, "AI Agent's one ready module");
});

test("Flawless: a boss won with every heart left", () => {
  assert.equal(meets(badge("flawless"), ctx, state({ bossResults: [{ won: true, hearts: 2 }] })), false);
  assert.equal(meets(badge("flawless"), ctx, state({ bossResults: [{ won: false, hearts: 3 }] })), false);
  assert.equal(meets(badge("flawless"), ctx, state({ bossResults: [{ won: true, hearts: 3 }] })), true);
});

test("Explorer: a module passed in every branch that has one ready", () => {
  assert.equal(meets(badge("explorer"), ctx, state({ completed: ["F1"] })), false);
  assert.equal(meets(badge("explorer"), ctx, state({ completed: ["F1", "A1"] })), true, "Payments has nothing ready yet");
});

test("criteria lines: runs of three or more as a range, the rest one by one", () => {
  assert.equal(idList(["F1", "F2", "F3", "F4", "F5", "FC1", "F6", "F7", "FC2"]), "F1–F7, FC1 and FC2");
  assert.equal(idList(["F8", "F9", "F10", "F11", "F12", "FC3", "F13"]), "F8–F13 and FC3");
  assert.equal(idList(["N5"]), "N5");
  assert.equal(idList(["A2", "A4"]), "A2 and A4");
});

test("the course's badges: a tier badge per named tier, a boss badge per boss, and the skills", () => {
  // Read, not built: buildCourse() rewrites web/public/content, and content.test.mjs builds it
  // at the same time in another process.
  const quests = loadQuests();
  const course = { branches: quests.branches, badges: loadBadges(quests) };
  const ids = course.badges.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const b of course.badges) assert.ok(ICON_NAMES.includes(b.icon), `${b.id}'s icon`);
  const agent = course.badges.filter((b) => b.branch === "ai-agent" && b.kind === "tier").map((b) => b.tier);
  assert.deepEqual(agent, [1, 3], "Code Mode (tier II) has no badge");
  for (const branch of course.branches.filter((b) => b.boss)) {
    const boss = course.badges.find((b) => b.id === `${branch.id}-boss`);
    assert.equal(boss.name, branch.classTitle);
    assert.ok(boss.name.length <= CLASS_TITLE_MAX);
  }
  assert.equal(course.badges.find((b) => b.id === "fundamentals-1").criteria, "Pass F1–F7, FC1 and FC2");
  assert.deepEqual(course.badges.filter((b) => b.kind === "skill").map((b) => b.id), ["clean-run", "no-peeking", "flawless", "explorer", "cross-team"]);
});

test("a medal is drawn locked or earned, and small without its numeral and ribbon", () => {
  const tier = { kind: "tier", color: "green", icon: "sprout", numeral: "II", name: "Blocksmith" };
  assert.match(medalSvg(tier, { earned: false }), /is-locked/);
  assert.match(medalSvg(tier, { earned: true, size: 96 }), />II</);
  assert.doesNotMatch(medalSvg(tier, { earned: true, size: 20 }), />II</);
  const boss = { kind: "boss", color: "green", icon: "sprout", name: "Durable Apprentice" };
  assert.match(medalSvg(boss, { earned: true }), /DURABLE APPRENTICE/);
  assert.doesNotMatch(medalSvg(boss, { earned: true, size: 34 }), /DURABLE APPRENTICE/);
  assert.match(medalSvg({ kind: "skill", icon: "bolt" }, { earned: true }), /<circle/, "a skill badge is a coin");
});

// --- Kept by the server ---------------------------------------------------------------------------

const CATALOG = catalogOf({ modules: MODULES, exercises: [{ challenges: { FC1: { choices: [{ id: "A" }, { id: "B", right: true }] } } }], paths: [], badges: BADGES });

function server() {
  const clock = { now: Date.parse("2026-11-10T09:00:00Z") };
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run("u1", "a@acme.com", clock.now);
  const activity = new Activity(db, { catalog: CATALOG, now: () => clock.now });
  const badgeEvents = () => db.prepare("SELECT data FROM events WHERE type = 'badge_earned'").all().map((r) => JSON.parse(r.data));
  return { clock, activity, badgeEvents };
}

test("a badge is earned at the event that completed it", () => {
  const events = [
    { type: "module_passed", module_id: "F1", at: 100 },
    { type: "challenge_pick", module_id: "FC1", data: { choice: "B" }, at: 200 },
    { type: "module_passed", module_id: "FC1", at: 210 },
    { type: "module_passed", module_id: "F2", at: 300 },
  ];
  const progress = deriveProgress(events, CATALOG);
  assert.deepEqual(progress.badges, [
    { id: "clean-run", at: 200 },
    { id: "fundamentals-1", at: 300 },
    { id: "no-peeking", at: 300 },
  ]);
  assert.deepEqual(progress.unrecorded, ["clean-run", "fundamentals-1", "no-peeking"]);
});

test("the server records a badge once, and keeps it when the content changes", () => {
  const { activity, badgeEvents, clock } = server();
  activity.recordFromBrowser("u1", [{ type: "module_passed", moduleId: "A1" }]);
  assert.deepEqual(badgeEvents().map((d) => d.badge).sort(), ["cross-team", "no-peeking"]);
  activity.progress("u1");
  activity.recordFromBrowser("u1", [{ type: "module_opened", moduleId: "F1" }]);
  assert.equal(badgeEvents().length, 2, "recorded once");
  assert.equal(badgeEvents()[0].earnedAt, clock.now);

  // A1 becomes coming soon (or its badge's rule changes): the badges stay earned.
  const changed = catalogOf({ modules: MODULES.map((m) => (m.id === "A1" ? { ...m, status: "coming-soon" } : m)), exercises: [], paths: [], badges: BADGES });
  const later = new Activity(activity.db, { catalog: changed, now: () => clock.now });
  assert.deepEqual(later.progress("u1").badges.map((b) => b.id).sort(), ["cross-team", "no-peeking"]);
  // A badge taken out of the content is dropped.
  const fewer = catalogOf({ modules: MODULES, exercises: [], paths: [], badges: BADGES.filter((b) => b.id !== "cross-team") });
  assert.deepEqual(new Activity(activity.db, { catalog: fewer }).progress("u1").badges.map((b) => b.id), ["no-peeking"]);
});

test("solution_used is a page event, and counts against No Peeking", () => {
  const { activity } = server();
  assert.equal(activity.recordFromBrowser("u1", [{ type: "solution_used", moduleId: "A1" }, { type: "module_passed", moduleId: "A1" }]), 2);
  const progress = activity.progress("u1");
  assert.deepEqual(progress.solutionUsed, ["A1"]);
  assert.deepEqual(progress.badges.map((b) => b.id), ["cross-team"]);
});

test("earnedNow lists every badge met", () => {
  assert.deepEqual(earnedNow(BADGES, ctx, state({ completed: ["F1", "A1"] })), ["no-peeking", "explorer", "cross-team"]);
});
