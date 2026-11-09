import assert from "node:assert/strict";
import test from "node:test";

import { CHALLENGE_XP, addPick, misses, showsHint, solvedAt, xpFor } from "../web/src/challenge.js";
import { CHALLENGE_XP as BUILD_XP } from "../content/build.mjs";

test("a challenge is worth 20 XP first time, 10 second time, 2 after that, and nothing unsolved", () => {
  assert.deepEqual(CHALLENGE_XP, BUILD_XP);
  assert.equal(xpFor(["C"], "C"), 20);
  assert.equal(xpFor(["A", "C"], "C"), 10);
  assert.equal(xpFor(["A", "B", "C"], "C"), 2);
  assert.equal(xpFor(["A", "B", "D", "C"], "C"), 2);
  assert.equal(xpFor(["A", "B"], "C"), 0);
  assert.equal(solvedAt(["B", "C"], "C"), 2);
  assert.equal(solvedAt(["B"], "C"), null);
});

test("picks are recorded once each, and stop at the right one", () => {
  let attempts = [];
  attempts = addPick(attempts, "A", "C");
  attempts = addPick(attempts, "A", "C");
  assert.deepEqual(attempts, ["A"], "picking a struck-out choice again changes nothing");
  attempts = addPick(attempts, "C", "C");
  attempts = addPick(attempts, "B", "C");
  assert.deepEqual(attempts, ["A", "C"], "after the right pick, nothing more is recorded");
  assert.deepEqual(misses(attempts, "C"), ["A"]);
});

test("the hint shows after two misses, until it's solved", () => {
  assert.equal(showsHint([], "C"), false);
  assert.equal(showsHint(["A"], "C"), false);
  assert.equal(showsHint(["A", "B"], "C"), true);
  assert.equal(showsHint(["A", "B", "C"], "C"), false);
});

