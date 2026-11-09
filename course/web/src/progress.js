// The learner's progress through the skill tree: modules completed, XP and levels, the path
// they follow (an event's agenda), and what comes next. Kept in this browser (it survives a new
// sandbox: forget.js keeps it); issue 04 moves it to the server.
import { computed, reactive, watch } from "vue";

import { addPick, xpFor } from "./challenge.js";
import { course, load, save } from "./store.js";

export const LEVEL_XP = 50;

export const modulesById = new Map(course.modules.map((m) => [m.id, m]));
export const branchesById = new Map(course.branches.map((b) => [b.id, b]));
// Every module in map order: branch by branch, each in its own order, its boss last.
export const mapOrder = course.branches.flatMap((b) => [...b.modules, ...(b.boss ? [b.boss] : [])]);

function initialPath() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("path");
    if (fromUrl !== null) {
      const id = course.paths.some((p) => p.id === fromUrl) ? fromUrl : null;
      save("path", id);
      return id;
    }
  } catch {
    /* no URL to read */
  }
  const saved = load("path", null);
  return course.paths.some((p) => p.id === saved) ? saved : null;
}

export const progress = reactive({
  completed: load("modules", []).filter((id) => modulesById.has(id)),
  // Each challenge's picks, in order: { FC1: ["A", "C"] }. Its XP comes from them.
  attempts: load("attempts", {}),
  path: initialPath(),
  // The map's view: "focus" (Fundamentals' first tier, and where it leads) or "full"; null until
  // the learner picks one, which means focus until the branches open.
  mapView: load("map-view", null),
  // The last XP earned, for the top bar's animation: { id, amount, levelUp, at }.
  lastGain: null,
});

watch(() => progress.completed, (ids) => save("modules", ids), { deep: true });
watch(() => progress.attempts, (picks) => save("attempts", picks), { deep: true });
watch(() => progress.path, (id) => save("path", id));
watch(() => progress.mapView, (view) => save("map-view", view));

export const activePath = computed(() => course.paths.find((p) => p.id === progress.path) ?? null);

// A module's XP, or a challenge's for the picks it took (20, 10, then 2).
export function xpOf(id) {
  const m = modulesById.get(id);
  if (m?.kind !== "challenge") return m?.xp ?? 0;
  return xpFor(progress.attempts[id] ?? [], rightChoice(id));
}
export const xp = computed(() => progress.completed.reduce((sum, id) => sum + xpOf(id), 0));
export const level = computed(() => Math.floor(xp.value / LEVEL_XP) + 1);
export const levelXp = computed(() => xp.value % LEVEL_XP);
// The class title of the last boss beaten; "Initiate" before any.
export const title = computed(() => {
  const boss = [...progress.completed].reverse().map((id) => modulesById.get(id)).find((m) => m?.kind === "boss");
  return boss ? branchesById.get(boss.branch).classTitle : "Initiate";
});

export const isDone = (id) => progress.completed.includes(id);
export const isPlayable = (m) => m.status === "ready" && ["module", "challenge"].includes(m.kind) && Boolean(m.exercise);
// A challenge gates the module after it, softly: that module looks locked until it's done.
const gates = new Map();
for (const m of course.modules) if (m.kind === "challenge" && m.before) gates.set(m.before, [...(gates.get(m.before) ?? []), m.id]);
export const isUnlocked = (m) => m.requires.every(isDone) && (gates.get(m.id) ?? []).every(isDone);
export const gatesOf = (id) => gates.get(id) ?? [];

// Where a learner stands with a module, one of four:
//   done    Completed
//   next    Next: what the map's Start opens
//   open    Available: what it builds on is done
//   locked  Locked: what it builds on isn't done yet
// Prerequisites are recommended, not required: a locked module can still be entered (skip ahead),
// and what it builds on is solved for you. Whether its content exists yet is separate:
// isPlayable (a module that's coming soon is on the map to plan with, and can't be entered).
export function stateOf(m) {
  if (isDone(m.id)) return "done";
  if (recommended.value?.id === m.id) return "next";
  return isUnlocked(m) ? "open" : "locked";
}

export const STATE_LABEL = { done: "Completed", next: "Next", open: "Available", locked: "Locked" };

// What a module builds on that isn't done yet: its own prerequisites (and a challenge that gates it).
export const missingFor = (m) => [...m.requires, ...gatesOf(m.id)].filter((id) => !isDone(id)).map((id) => modulesById.get(id));

// Everything a module builds on, however indirectly, that isn't done yet, in map order.
export function stepsBefore(m) {
  const seen = new Set();
  const visit = (id) => {
    for (const req of [...modulesById.get(id).requires, ...gatesOf(id)]) {
      if (seen.has(req) || isDone(req)) continue;
      seen.add(req);
      visit(req);
    }
  };
  visit(m.id);
  return mapOrder.filter((id) => seen.has(id)).map((id) => modulesById.get(id));
}

// The first thing to do on the way to a locked module: the first of its steps before it that's
// playable and not locked itself.
export const firstStepTo = (m) => stepsBefore(m).find((s) => isPlayable(s) && isUnlocked(s)) ?? null;

// The trunk (Fundamentals), and the module of its that the branches open after.
export const trunk = course.branches.find((b) => !b.column);
export const trunkTail = trunk.modules.filter((id) => modulesById.get(id).tier === 1 && modulesById.get(id).kind === "module").at(-1);

// The map opens on the focused view until the branches open, then on the full map, unless the
// learner picked one.
export const mapView = computed(() => progress.mapView ?? (isDone(trunkTail) ? "full" : "focus"));

// The way to a branch: its modules and boss, and everything they build on, however indirectly
// (done or not), as a set of ids.
export function routeTo(branch) {
  const out = new Set();
  const visit = (id) => {
    if (out.has(id)) return;
    out.add(id);
    for (const req of [...modulesById.get(id).requires, ...gatesOf(id)]) visit(req);
  };
  for (const id of [...branch.modules, ...(branch.boss ? [branch.boss] : [])]) visit(id);
  return out;
}

// What a branch opens after: the prerequisites of its first modules that are in another branch.
export function opensAfter(branch) {
  const out = new Set();
  for (const id of branch.modules) for (const req of modulesById.get(id).requires) if (modulesById.get(req).branch !== branch.id) out.add(req);
  return [...out].map((id) => modulesById.get(id));
}

export function complete(id) {
  const m = modulesById.get(id);
  if (!m || isDone(id)) return;
  const before = level.value;
  progress.completed = [...progress.completed, id];
  progress.lastGain = { id, amount: xpOf(id), levelUp: level.value > before ? level.value : null, at: Date.now() };
}

// The right choice of a challenge, from the exercise that has it.
function rightChoice(id) {
  const exercise = course.exercises.find((ex) => ex.challenges?.[id]);
  return exercise?.challenges[id].choices.find((c) => c.right)?.id ?? null;
}

// A pick in a challenge: recorded, and the right one completes it, with the XP its picks earned.
export function pick(id, choiceId) {
  const right = rightChoice(id);
  progress.attempts = { ...progress.attempts, [id]: addPick(progress.attempts[id] ?? [], choiceId, right) };
  if (choiceId === right) complete(id);
}

export function forgetProgress() {
  progress.completed = [];
  progress.attempts = {};
}

// What Continue opens: on a path, its first module not done; otherwise the first playable module
// not done whose prerequisites are, in map order (and failing that, the first not done).
export const recommended = computed(() => {
  const playable = (id) => modulesById.get(id) && isPlayable(modulesById.get(id));
  if (activePath.value) {
    const id = activePath.value.modules.find((m) => playable(m) && !isDone(m));
    return id ? modulesById.get(id) : null;
  }
  const open = mapOrder.map((id) => modulesById.get(id)).filter((m) => isPlayable(m) && !isDone(m.id));
  return open.find(isUnlocked) ?? open[0] ?? null;
});

// The module after this one: the path's next, when it's on the active path; otherwise the next
// playable one in its branch. null at the end.
export function nextModule(id) {
  const path = activePath.value?.modules ?? [];
  const at = path.indexOf(id);
  if (at >= 0) {
    const next = path.slice(at + 1).find((m) => isPlayable(modulesById.get(m)));
    return next ? modulesById.get(next) : null;
  }
  const m = modulesById.get(id);
  if (!m) return null;
  const branch = branchesById.get(m.branch).modules;
  const next = branch.slice(branch.indexOf(id) + 1).find((other) => isPlayable(modulesById.get(other)));
  return next ? modulesById.get(next) : null;
}

// Where a module sits in its branch: { index (1-based), total } over the playable ones.
export function branchPosition(id) {
  const m = modulesById.get(id);
  const playable = branchesById.get(m.branch).modules.filter((other) => isPlayable(modulesById.get(other)));
  return { index: playable.indexOf(id) + 1, total: playable.length };
}

// The module a beat of an exercise's guide belongs to (the getting-started beats: its first).
export function moduleOfBeat(exercise, beatId) {
  const found = Object.entries(exercise.moduleBeats ?? {}).find(([, beats]) => beats.includes(beatId));
  return found?.[0] ?? exercise.modules?.[0] ?? null;
}

export const moduleHref = (id) => `#/module/${id}`;
