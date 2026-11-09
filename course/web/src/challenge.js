// A challenge's rules, on their own so they can be tested: what its picks are worth, and when
// it offers its hint. `attempts` is the choices picked, in order; the run stops at the right one.

// The XP for a challenge solved on the 1st, 2nd, and any later pick (build.mjs's CHALLENGE_XP).
export const CHALLENGE_XP = [20, 10, 2];

export function solvedAt(attempts, rightId) {
  const at = attempts.indexOf(rightId);
  return at < 0 ? null : at + 1;
}

export function xpFor(attempts, rightId, table = CHALLENGE_XP) {
  const at = solvedAt(attempts, rightId);
  return at === null ? 0 : table[Math.min(at, table.length) - 1];
}

// The wrong picks so far: they're struck out, and after two the hint shows.
export const misses = (attempts, rightId) => attempts.filter((id) => id !== rightId);
export const showsHint = (attempts, rightId) => misses(attempts, rightId).length >= 2 && solvedAt(attempts, rightId) === null;

// A pick, added to the attempts: once it's solved, or a choice is already picked, nothing changes.
export function addPick(attempts, choiceId, rightId) {
  if (solvedAt(attempts, rightId) !== null || attempts.includes(choiceId)) return attempts;
  return [...attempts, choiceId];
}

