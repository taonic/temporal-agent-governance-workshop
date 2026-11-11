// The learner's progress through the skill tree: modules completed, XP and levels, the path
// they follow (their cohort's agenda, or one they picked), and what comes next. The server keeps
// it, as events (runner/activity.mjs): a signed-in learner's progress follows them across
// browsers. This browser keeps a copy (it survives a new sandbox: forget.js keeps it), and what
// it had before the learner's first sign-in is imported then.
//
// While signed in, the page also tells the server which module is open, once a minute while the
// tab is visible (a heartbeat): that's how time on a module is measured.
//
// Badges (badges.js) are kept once earned: { id: when }, from the server and from what this page
// sees the learner earn. Earning one here sets lastBadges, for the earn moment (EarnMoment.vue).
import { computed, reactive, watch } from "vue";

import { badgeContext, earnedNow, isComingSoon, missingFor as badgeMissingFor } from "./badges.js";
import { addPick, xpFor } from "./challenge.js";
import { keepPersona } from "./persona.js";
import { api, course, load, save, store } from "./store.js";

export const LEVEL_XP = 50;

export const modulesById = new Map(course.modules.map((m) => [m.id, m]));
export const branchesById = new Map(course.branches.map((b) => [b.id, b]));
// Every module in map order: branch by branch, each in its own order, its boss last.
export const mapOrder = course.branches.flatMap((b) => [...b.modules, ...(b.boss ? [b.boss] : [])]);

let pathFromUrl = false;
function initialPath() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("path");
    if (fromUrl !== null) {
      pathFromUrl = true;
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
  // The modules whose solution the learner peeked at or applied (No Peeking).
  solutionUsed: load("solution-used", []),
  // The badges earned, and when: { "fundamentals-1": 1762765200000 }.
  badges: load("badges", {}),
  // The badges just earned, for the earn moment: { ids, at }.
  lastBadges: null,
  // Each boss fight's result: [{ module, won, hearts, at }] (Flawless: a win with every heart).
  bossResults: load("boss-results", []),
});

watch(() => progress.completed, (ids) => save("modules", ids), { deep: true });
watch(() => progress.solutionUsed, (ids) => save("solution-used", ids), { deep: true });
watch(() => progress.badges, (badges) => save("badges", badges), { deep: true });
watch(() => progress.attempts, (picks) => save("attempts", picks), { deep: true });
watch(() => progress.path, (id) => save("path", id));
watch(() => progress.bossResults, (results) => save("boss-results", results), { deep: true });

// --- The server's copy ------------------------------------------------------------------------

// Events for the server, sent in a batch a moment after the last one. Only while signed in.
const outbox = [];
let flushTimer = 0;
export function track(type, moduleId = null, data = null) {
  if (!store.authenticated) return;
  outbox.push({ type, moduleId, data });
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 400);
}

async function flush() {
  if (!outbox.length || !store.authenticated) return;
  const events = outbox.splice(0, outbox.length);
  try {
    await api("/api/events", { method: "POST", body: { events } });
  } catch {
    // Kept for the next try, unless signed out.
    if (store.authenticated) outbox.unshift(...events);
  }
}
window.addEventListener("pagehide", () => {
  if (outbox.length && store.authenticated) navigator.sendBeacon?.("/api/events", new Blob([JSON.stringify({ events: outbox.splice(0) })], { type: "application/json" }));
});

// At sign-in: what this browser has goes up (kept only at the learner's first sign-in), and the
// server's progress comes back, in place of this browser's. When this browser's progress is
// already this learner's, anything the server doesn't have yet (a pass whose event didn't get
// there before a reload) is sent again and kept. Another learner's isn't.
let syncing = false;
async function syncFromServer() {
  const email = store.user?.email;
  const owner = load("progress-owner", null);
  const mine = owner === email;
  try {
    const server = await api("/api/progress/import", {
      method: "POST",
      body: owner && !mine ? {} : { completed: progress.completed, attempts: progress.attempts, path: progress.path },
    });
    const unsent = mine ? progress.completed.filter((id) => !server.completed.includes(id)) : [];
    for (const id of unsent) track("module_passed", id);
    syncing = true;
    progress.completed = [...server.completed, ...unsent].filter((id) => modulesById.has(id));
    progress.attempts = mine ? { ...progress.attempts, ...server.attempts } : server.attempts;
    progress.solutionUsed = [...new Set([...(mine ? progress.solutionUsed : []), ...(server.solutionUsed ?? [])])];
    const kept = Object.fromEntries((server.badges ?? []).filter((b) => badgesById.has(b.id)).map((b) => [b.id, b.at ?? Date.now()]));
    progress.badges = mine ? { ...progress.badges, ...kept } : kept;
    save("progress-owner", email);
    if (!pathFromUrl) progress.path = course.paths.some((p) => p.id === server.path) ? server.path : null;
    else if (server.path !== progress.path) track("path_set", null, { path: progress.path });
    // The persona follows the learner: the server's (their choice, or their cohort's) wins, unless
    // this page's URL set one; one chosen here before signing in goes up.
    if (server.persona && server.persona !== store.persona.id && !store.persona.fromUrl) choosePersona(server.persona, { record: false });
    else if (store.persona.chosen && server.persona !== store.persona.id) track("persona_set", null, { persona: store.persona.id });
  } catch {
    /* the page keeps this browser's progress */
  } finally {
    syncing = false;
  }
}
watch(() => store.authenticated, (signedIn) => signedIn && syncFromServer(), { immediate: true });

// A path the learner picks (on the map, or with ?path=) is theirs from then on.
watch(() => progress.path, (path) => !syncing && track("path_set", null, { path }));

// The module open on the page: opened (an event) and a heartbeat now, then one a minute while the
// tab is visible.
const HEARTBEAT_MS = 60_000;
const openModule = computed(() => (store.authenticated && store.route.page === "exercise" ? (store.route.module ?? null) : null));
function heartbeat() {
  if (openModule.value && document.visibilityState === "visible") api("/api/heartbeat", { method: "POST", body: { moduleId: openModule.value } }).catch(() => {});
}
watch(openModule, (id) => {
  if (!id) return;
  track("module_opened", id);
  heartbeat();
});
setInterval(heartbeat, HEARTBEAT_MS);
document.addEventListener("visibilitychange", heartbeat);
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
// --- Badges -------------------------------------------------------------------------------------

export const badges = course.badges ?? [];
export const badgesById = new Map(badges.map((b) => [b.id, b]));
const badgeCtx = badgeContext(course.modules, (id) => rightChoice(id));
const badgeState = () => ({ completed: progress.completed, attempts: progress.attempts, solutionUsed: progress.solutionUsed, bossResults: progress.bossResults });
// The badges the learner meets now. Any not kept yet are kept, quietly (what the server sent, or
// a sign-in's progress): only one earned on this page gets an earn moment (complete, below).
const meetsNow = computed(() => earnedNow(badges, badgeCtx, badgeState()));
watch(
  meetsNow,
  (ids) => {
    const fresh = ids.filter((id) => !(id in progress.badges));
    if (fresh.length) progress.badges = { ...progress.badges, ...Object.fromEntries(fresh.map((id) => [id, Date.now()])) };
  },
  { immediate: true },
);
export const isEarned = (id) => id in progress.badges || meetsNow.value.includes(id);
export const earnedCount = computed(() => badges.filter((b) => isEarned(b.id)).length);
// What an earned badge's tier has gained since (it's kept): the modules not done.
export const badgeMissing = (badge) => badgeMissingFor(badge, badgeCtx, progress.completed);
export const badgeComingSoon = (badge) => isComingSoon(badge, badgeCtx);

// The class title: the boss badge earned last. "Initiate" before any.
export const titleBadge = computed(() =>
  badges
    .filter((b) => b.kind === "boss" && isEarned(b.id))
    .sort((a, b) => (progress.badges[a.id] ?? 0) - (progress.badges[b.id] ?? 0))
    .at(-1) ?? null,
);
export const title = computed(() => titleBadge.value?.name ?? "Initiate");

// The learner peeked at or applied a module's solution: once per module.
export function markSolutionUsed(id) {
  if (!id || !modulesById.has(id) || progress.solutionUsed.includes(id)) return;
  progress.solutionUsed = [...progress.solutionUsed, id];
  track("solution_used", id);
}

export const isDone = (id) => progress.completed.includes(id);
// Whether the learner sees a module's id (M3, EC1…): not on a branch with `numbered: false`
// (Essentials), which names its modules by title alone.
export const numbered = (m) => branchesById.get(m.branch)?.numbered !== false;
// A module's id where it's shown, else "". moduleName: "M3 · Title", or the title alone.
export const idOf = (m) => (numbered(m) ? m.id : "");
export const moduleName = (m) => (numbered(m) ? `${m.id} · ${m.title}` : m.title);

// A boss is playable with its pool of stories (BossPage); a module or challenge in its exercise.
export const isPlayable = (m) =>
  m.status === "ready" && (m.kind === "boss" ? Boolean(m.pool?.length) : ["module", "challenge"].includes(m.kind) && Boolean(m.exercise));
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
  track("module_passed", id);
  const fresh = meetsNow.value.filter((b) => !(b in progress.badges));
  if (fresh.length) {
    const at = Date.now();
    progress.badges = { ...progress.badges, ...Object.fromEntries(fresh.map((b) => [b, at])) };
    progress.lastBadges = { ids: fresh, at };
  }
}

// A boss fight's end: recorded (here, and on the server, for Flawless), and a win completes the
// boss, with its XP and its badges (the result first, so Flawless is earned with it).
export function finishBoss(id, won, hearts) {
  progress.bossResults = [...progress.bossResults, { module: id, won, hearts, at: Date.now() }];
  track("boss_result", id, { won, hearts });
  if (won) complete(id);
}

// The right choice of a challenge, from the exercise that has it.
function rightChoice(id) {
  const exercise = course.exercises.find((ex) => ex.challenges?.[id]);
  return exercise?.challenges[id].choices.find((c) => c.right)?.id ?? null;
}

// A pick in a challenge: recorded, and the right one completes it, with the XP its picks earned.
export function pick(id, choiceId) {
  const right = rightChoice(id);
  const before = progress.attempts[id] ?? [];
  progress.attempts = { ...progress.attempts, [id]: addPick(before, choiceId, right) };
  if (progress.attempts[id] !== before) track("challenge_pick", id, { choice: choiceId, right: choiceId === right });
  if (choiceId === right) complete(id);
}

// --- Essentials' world checks ------------------------------------------------------------------
// A Trip board module passes when the board has seen what its check names happen (the board
// reports it, store.board.state.check) and its one question is answered right. Both are kept in
// this browser until then ({ E1: when }, { E1: ["B", "A"] }); the pass itself is what the server
// keeps, as for any module.
const worldChecks = new Map(course.exercises.flatMap((ex) => Object.entries(ex.checks ?? {})));
export const worldCheckOf = (id) => worldChecks.get(id) ?? null;
export const essentials = reactive({ seen: load("world-seen", {}), quizzes: load("quizzes", {}) });
watch(() => essentials.seen, (seen) => save("world-seen", seen), { deep: true });
watch(() => essentials.quizzes, (picks) => save("quizzes", picks), { deep: true });

export const worldSeen = (id) => isDone(id) || Boolean(essentials.seen[id]);
const quizRight = (id) => worldCheckOf(id)?.quiz.choices.find((c) => c.right)?.id ?? null;
export const quizPicks = (id) => essentials.quizzes[id] ?? [];
export const quizAnswered = (id) => isDone(id) || quizPicks(id).includes(quizRight(id));

export function quizPick(id, choiceId) {
  const before = quizPicks(id);
  const after = addPick(before, choiceId, quizRight(id));
  if (after !== before) {
    essentials.quizzes = { ...essentials.quizzes, [id]: after };
    // Recorded too: the Derby scores a module by how its question went (runner/race.mjs).
    track("quiz_pick", id, { choice: choiceId, right: choiceId === quizRight(id) });
  }
  passIfChecked(id);
}

function passIfChecked(id) {
  if (worldCheckOf(id) && !isDone(id) && worldSeen(id) && quizAnswered(id)) complete(id);
}

// What the board reports: this module's check, passed. Seen once, it stays seen.
watch(
  () => store.board.state?.check,
  (check) => {
    const id = check?.passed ? store.board.state.module : null;
    if (!id || !worldCheckOf(id) || essentials.seen[id]) return;
    essentials.seen = { ...essentials.seen, [id]: Date.now() };
    passIfChecked(id);
  },
);

// The learner's persona: kept (and recorded, while signed in). Another persona's course is another
// site, so the page loads again, on the map (the module open may not be in it).
export function choosePersona(id, { record = true } = {}) {
  if (!course.personas.some((p) => p.id === id)) return;
  keepPersona(id);
  if (record) track("persona_set", null, { persona: id });
  if (id === course.persona) {
    store.persona = { ...store.persona, chosen: true };
    return;
  }
  // Sent as the page goes (pagehide's beacon), so the server has it when the new page asks.
  const url = new URL(window.location.href);
  url.searchParams.delete("persona");
  url.hash = "#/";
  window.location.replace(url.toString());
  if (url.toString() === window.location.href) window.location.reload();
}

export function forgetProgress() {
  essentials.seen = {};
  essentials.quizzes = {};
  progress.completed = [];
  progress.attempts = {};
  progress.solutionUsed = [];
  progress.badges = {};
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
  const branch = branchesById.get(m.branch);
  const next = branch.modules.slice(branch.modules.indexOf(id) + 1).find((other) => isPlayable(modulesById.get(other)));
  if (next) return modulesById.get(next);
  // The branch's last step leads to its boss, once it's playable.
  const boss = branch.boss && id !== branch.boss ? modulesById.get(branch.boss) : null;
  return boss && isPlayable(boss) ? boss : null;
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
