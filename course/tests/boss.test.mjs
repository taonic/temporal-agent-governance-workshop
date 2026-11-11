import assert from "node:assert/strict";
import { test } from "node:test";

import { BOSS_HP, advance, answer, answered, current, drawFight } from "../web/src/boss.js";
import { HEARTS } from "../web/src/badges.js";

// Two stories for each of eight modules, as Essentials' pool has.
const POOL = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"].flatMap((m) =>
  [1, 2].map((n) => ({ id: `${m}-${n}`, module: m, story: `${m} story ${n}`, why: "because", choices: [{ label: "right", right: true }, { label: "wrong a", right: false }, { label: "wrong b", right: false }] })),
);
// A seeded random, so a draw can be repeated.
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rightOf = (fight) => current(fight).choices.findIndex((c) => c.right);
const wrongOf = (fight) => current(fight).choices.findIndex((c) => !c.right);
const play = (fight, picks) => picks.reduce((f, pick) => advance(answer(f, pick === "right" ? rightOf(f) : wrongOf(f))), fight);

test("a fight draws one story per module, in the course's order, then the rest of the pool", () => {
  const fight = drawFight(POOL, seeded(7));
  assert.deepEqual(fight.stories.slice(0, 8).map((s) => s.module), ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"]);
  assert.equal(fight.stories.length, POOL.length);
  assert.equal(new Set(fight.stories.map((s) => s.id)).size, POOL.length);
  assert.equal(fight.hp, BOSS_HP);
  assert.equal(fight.hearts, HEARTS);
  // Every story keeps exactly one right choice, wherever the shuffle put it.
  assert.ok(fight.stories.every((s) => s.choices.filter((c) => c.right).length === 1));
});

test("a retry is a new draw", () => {
  const draws = new Set([1, 2, 3, 4, 5].map((seed) => drawFight(POOL, seeded(seed)).stories.slice(0, 8).map((s) => s.id).join()));
  assert.ok(draws.size > 1);
});

test("eight right answers beat the boss, with every heart left", () => {
  const fight = play(drawFight(POOL, seeded(3)), Array(8).fill("right"));
  assert.equal(fight.outcome, "won");
  assert.equal(fight.hp, 0);
  assert.equal(fight.hearts, HEARTS);
  assert.equal(current(fight), null);
});

test("a wrong answer costs a heart, and the fight goes on to more stories", () => {
  const fight = play(drawFight(POOL, seeded(3)), ["right", "wrong", "right", "right", "right", "right", "right", "right", "right"]);
  assert.equal(fight.outcome, "won");
  assert.equal(fight.hearts, HEARTS - 1);
  assert.equal(fight.answers.length, 9);
});

test("the third wrong answer loses the fight", () => {
  const fight = play(drawFight(POOL, seeded(3)), ["wrong", "right", "wrong", "right", "wrong"]);
  assert.equal(fight.outcome, "lost");
  assert.equal(fight.hearts, 0);
  assert.equal(fight.hp, BOSS_HP - 2);
});

test("a story takes one answer, and the next waits for advance", () => {
  let fight = drawFight(POOL, seeded(9));
  fight = answer(fight, rightOf(fight));
  assert.ok(answered(fight));
  const again = answer(fight, 0);
  assert.equal(again, fight, "a second answer to the same story is ignored");
  assert.equal(advance(fight).at, 1);
});
