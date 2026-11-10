// Feedback, for signed-in users: the form's state (its draft survives closing it), and where the
// learner is, filled in for them: the page, the exercise, the module, the guide's step, or the map
// node they're looking at. The runner keeps it and emails it (runner/feedback.mjs).
import { reactive } from "vue";

import { api, course, effectiveMode, store } from "./store.js";

export const KINDS = [
  { id: "bug", label: "Something's broken" },
  { id: "confusing", label: "Confusing" },
  { id: "idea", label: "Idea" },
  { id: "praise", label: "I liked this" },
];

// The runner's limit too (feedback.mjs MAX_MESSAGE).
export const MAX_MESSAGE = 5000;

export const feedback = reactive({ open: false, kind: "", draft: "", where: null, attach: true, busy: false, error: "" });

const modules = new Map(course.modules.map((m) => [m.id, m]));
const ONBOARD_TITLES = { "start-ask": "Set up Ask Temporal", "start-workspace": "Your workspace", intro: "Introduction" };

// Where the learner is now, as the runner keeps it (feedback.mjs cleanContext) plus `label`.
export function whereNow() {
  const route = store.route;
  const where = {
    page: route.page,
    url: window.location.hash || "#/",
    sandbox: store.runtime.enabled && store.authenticated && route.page === "exercise" ? (store.sandboxLost ? "lost" : store.sandbox.state) : null,
    theme: store.theme,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
  const parts = [];
  if (route.page === "exercise") {
    const exercise = course.exercises.find((e) => e.id === route.id);
    if (exercise) {
      where.exerciseId = exercise.id;
      where.exerciseTitle = `Exercise ${exercise.number} · ${exercise.title}`;
      parts.push(where.exerciseTitle);
      const module = modules.get(route.module ?? exercise.modules[0]);
      if (module) Object.assign(where, { moduleId: module.id, moduleTitle: module.title });
      const beatId = store.guideBeat;
      if (beatId) {
        const sections = exercise.modes[effectiveMode()]?.sections ?? [];
        where.beatId = beatId;
        where.beatTitle = sections.find((s) => s.id === beatId)?.title ?? ONBOARD_TITLES[beatId] ?? beatId;
      }
    }
  } else if (route.page === "home") {
    const module = modules.get(store.mapFocus);
    parts.push("The map");
    if (module) Object.assign(where, { moduleId: module.id, moduleTitle: module.title });
  } else if (route.page === "setup") parts.push("Setup");
  else if (route.page === "admin") {
    where.adminTab = route.id;
    parts.push(`Admin panel (${route.id})`);
  }
  if (where.moduleId) parts.push(`${where.moduleId} · ${where.moduleTitle}`);
  if (where.beatTitle && !sameStep(where.beatTitle, where.moduleTitle)) parts.push(`step “${where.beatTitle}”`);
  where.label = parts.join(" › ");
  return where;
}

// A module that's one step is often titled like it: "3. Restart the worker" and "Restart the worker".
export const sameStep = (beat, module) => Boolean(module) && beat.replace(/^\d+\.\s*/, "").toLowerCase() === module.toLowerCase();

export function openFeedback(kind) {
  feedback.where = whereNow();
  feedback.attach = true;
  feedback.error = "";
  if (kind) feedback.kind = kind;
  feedback.open = true;
}

export function closeFeedback() {
  feedback.open = false;
}

// Sends it; true when it's kept. Without "where I am", only the page goes with it.
export async function sendFeedback() {
  if (feedback.busy || !feedback.draft.trim()) return false;
  feedback.busy = true;
  feedback.error = "";
  try {
    const { label: _label, ...where } = feedback.where ?? whereNow();
    const context = feedback.attach ? where : { page: where.page, theme: where.theme, viewport: where.viewport };
    await api("/api/feedback", { method: "POST", body: { message: feedback.draft, kind: feedback.kind || null, context } });
    feedback.draft = "";
    feedback.kind = "";
    feedback.open = false;
    return true;
  } catch (err) {
    feedback.error = err.status === 401 ? "Your session ended: sign in again to send it (your note is kept here)." : err.message;
    return false;
  } finally {
    feedback.busy = false;
  }
}
