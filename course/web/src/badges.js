// Which badges a learner has earned, from what they've done: one set of rules for the page
// (progress.js) and the server (runner/activity.mjs), so the two agree.
//
// The badges themselves are content (course.badges, from branch.md and quests/badges.yaml):
//   tier   { modules }  every module and challenge in a tier
//   boss   { module }   the boss beaten (its badge is the branch's class title)
//   skill  { rule }     one of the rules below, earned once across the whole course
//
// Only modules that are ready count: a tier whose modules are all coming soon can't be earned
// yet, and a module that ships into an earned tier doesn't take its badge away (badges are kept
// once earned; see `missingFor`).
import { solvedAt } from "./challenge.js";

// A boss's hearts: a win with all of them left is Flawless.
export const HEARTS = 3;

export const SKILL_RULES = ["clean-run", "no-peeking", "flawless", "explorer", "pass"];

// What the rules need to know about the course, worked out once: `modules` as course.modules
// lists them, and each challenge's right choice.
export function badgeContext(modules, rightChoice) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const branches = new Map();
  for (const m of modules) {
    if (m.kind === "boss" || m.status !== "ready") continue;
    branches.set(m.branch, [...(branches.get(m.branch) ?? []), m]);
  }
  return { byId, branches, rightChoice };
}

const ready = (ctx, ids) => ids.filter((id) => ctx.byId.get(id)?.status === "ready");

// The ready modules a badge needs that aren't done: an earned tier badge that shows them has
// grown since ("+1 new module").
export function missingFor(badge, ctx, completed) {
  const done = new Set(completed);
  const ids = badge.kind === "tier" ? badge.modules : badge.module ? [badge.module] : [];
  return ready(ctx, ids).filter((id) => !done.has(id));
}

// Whether nothing a badge needs has shipped yet (a stub branch's tier, a boss to come).
export function isComingSoon(badge, ctx) {
  if (badge.kind === "tier") return ready(ctx, badge.modules).length === 0;
  if (badge.kind === "boss" || badge.rule === "pass") return ready(ctx, [badge.module]).length === 0;
  return false;
}

// Does the learner meet a badge's criteria now? `state`: { completed, attempts, solutionUsed,
// bossResults: [{ won, hearts }] }.
export function meets(badge, ctx, state) {
  const done = state.completed instanceof Set ? state.completed : new Set(state.completed);
  const branchList = [...ctx.branches.values()];
  switch (badge.kind === "skill" ? badge.rule : badge.kind) {
    case "tier": {
      const need = ready(ctx, badge.modules);
      return need.length > 0 && need.every((id) => done.has(id));
    }
    case "boss":
    case "pass":
      return ready(ctx, [badge.module]).length > 0 && done.has(badge.module);
    case "explorer":
      return branchList.length > 0 && branchList.every((mods) => mods.some((m) => m.kind === "module" && done.has(m.id)));
    case "clean-run":
      return branchList.some((mods) => {
        const challenges = mods.filter((m) => m.kind === "challenge");
        return challenges.length > 0 && challenges.every((c) => solvedAt(state.attempts?.[c.id] ?? [], ctx.rightChoice(c.id)) === 1);
      });
    case "no-peeking": {
      const used = new Set(state.solutionUsed ?? []);
      return branchList.some((mods) => mods.every((m) => done.has(m.id) && !used.has(m.id)));
    }
    case "flawless":
      return (state.bossResults ?? []).some((r) => r.won && r.hearts >= HEARTS);
    default:
      return false;
  }
}

// The ids of every badge the learner meets now.
export function earnedNow(badges, ctx, state) {
  const done = new Set(state.completed);
  return badges.filter((b) => meets(b, ctx, { ...state, completed: done })).map((b) => b.id);
}
