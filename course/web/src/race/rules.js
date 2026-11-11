// The Derby's scoring, shared by the runner (runner/race.mjs scores with it) and the page (the
// rules a racer reads, RacePill.vue): so what they're told is what's scored. No imports.

// Every question is worth the same in the race: the one that ends a stop, and a quick question
// (a challenge) alike. The boss is a fight, not a question: it keeps its own XP.
export const QUESTION_XP = 10;

// A question's XP by the try it was right on: all of it, half, then a fifth (10, 5, then 2).
export const QUIZ_SHARE = [1, 0.5, 0.2];

// What a stop is worth in the race, right first time.
export const stopXp = (kind, xp) => (kind === "boss" ? xp : QUESTION_XP);

// A module's XP for the race, by its question's picks (QUIZ_SHARE). One passed with no answer
// recorded (a page from before answers were) gets all of it.
export function quizXp(xp, picks, right) {
  if (!picks?.length) return xp;
  const at = picks.indexOf(right);
  const tries = at < 0 ? picks.length + 1 : at + 1;
  return Math.round(xp * QUIZ_SHARE[Math.min(tries, QUIZ_SHARE.length) - 1]);
}

// "10, 5, then 2": what a stop pays on the first, second and later tries.
export const triesText = (values) => `${values.slice(0, -1).join(", ")}, then ${values.at(-1)}`;
export const quizTries = (xp) => QUIZ_SHARE.map((share) => Math.round(xp * share));
