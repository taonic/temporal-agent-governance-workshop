// A boss fight: the boss has BOSS_HP, the learner HEARTS. A right answer costs the boss 1 HP, a
// wrong one costs the learner a heart: the boss at 0 is a win, the learner at 0 a loss, and a
// retry is a new draw. No timer. Pure, so the page (BossPage.vue) and the tests share it.
//
// The draw: one story for each module the pool covers, in the course's order (the pool's), so a
// fight walks the whole branch; then the rest of the pool, shuffled, for when a wrong answer means
// more stories are needed. Each story's choices are shuffled too.
import { HEARTS } from "./badges.js";

export const BOSS_HP = 8;

function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function drawFight(pool, random = Math.random) {
  const byModule = new Map();
  for (const q of pool) byModule.set(q.module, [...(byModule.get(q.module) ?? []), q]);
  const first = [...byModule.values()].map((stories) => stories[Math.floor(random() * stories.length)]);
  const rest = shuffled(pool.filter((q) => !first.includes(q)), random);
  const stories = [...first, ...rest].map((q) => ({ ...q, choices: shuffled(q.choices, random) }));
  return { stories, at: 0, hp: BOSS_HP, hearts: HEARTS, answers: [], outcome: null };
}

// The story being told, or null once the fight is over.
export const current = (fight) => (fight.outcome ? null : fight.stories[fight.at] ?? null);

// An answer to the current story (its choice's index): the fight as it leaves it, with this
// story's answer recorded. The next story waits for `advance`, so the page can show why.
export function answer(fight, choice) {
  const story = current(fight);
  if (!story || fight.answers.length > fight.at) return fight;
  const right = Boolean(story.choices[choice]?.right);
  const hp = fight.hp - (right ? 1 : 0);
  const hearts = fight.hearts - (right ? 0 : 1);
  // Out of stories without a result (a pool too small for the misses): the boss wins.
  const outOfStories = fight.at + 1 >= fight.stories.length;
  const outcome = hp <= 0 ? "won" : hearts <= 0 || outOfStories ? "lost" : null;
  return { ...fight, hp, hearts, outcome, answers: [...fight.answers, { story: story.id, choice, right }] };
}

export const answered = (fight) => fight.answers.length > fight.at;

export function advance(fight) {
  return answered(fight) && !fight.outcome ? { ...fight, at: fight.at + 1 } : fight;
}
