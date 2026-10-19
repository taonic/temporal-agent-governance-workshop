// Ask Temporal: the helper's state, and its conversations with the runner. Answers stream from
// /api/helper/ask (see course/runner/helper.mjs). There are two threads, both kept in this
// browser: the panel's, and the guide's (questions asked from a step of the instructions,
// each message tagged with the exercise and step it belongs to).
import { reactive, watch } from "vue";

import { api, course, editorContext, effectiveMode, load, save, store, toast } from "./store.js";

const MAX_KEPT = 60;
const MAX_GUIDE_KEPT = 160;

export const helper = reactive({
  open: false,
  width: load("helper-width", 460),
  // From the runner: whether the helper is on here, and whether this learner's docs are connected.
  status: { checked: false, enabled: false, reason: "", signedIn: false, docs: "connect", sharedDocsKey: false },
  thread: load("helper-thread", []),
  guide: load("helper-guide", []),
  busy: false,
  // A selection the learner asked about: { text, source: "instructions" | "editor" | "terminal", path }.
  selection: null,
  includeCode: load("helper-include-code", true),
  connecting: false,
  focusTick: 0, // bumped to focus the question box
});

watch(() => helper.includeCode, (value) => save("helper-include-code", value));
watch(() => helper.width, (value) => save("helper-width", value));

function keep(key, read, max) {
  let timer = 0;
  watch(
    read,
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => save(key, read().slice(-max).map((m) => (m.state === "streaming" ? { ...m, state: "stopped" } : m))), 400);
    },
    { deep: true },
  );
}
keep("helper-thread", () => helper.thread, MAX_KEPT);
keep("helper-guide", () => helper.guide, MAX_GUIDE_KEPT);

const newId = () => Math.random().toString(36).slice(2, 10);

export async function refreshHelper() {
  try {
    helper.status = { checked: true, ...(await api("/api/helper")) };
  } catch (err) {
    helper.status = { checked: true, enabled: false, reason: err.status ? err.message : "The course runner isn't reachable.", signedIn: false, docs: "connect" };
  }
  return helper.status;
}

// Opens the panel, optionally about a selection, optionally asking straight away. Code from the
// editor is asked about straight away ("Explain this code") unless a question comes with it;
// other selections wait for one.
export function openHelper({ selection = null, question = "" } = {}) {
  if (!question && selection?.source === "editor" && selection.text?.trim()) question = selectionPrompts("editor")[0];
  helper.open = true;
  if (selection?.text?.trim()) helper.selection = { ...selection, text: selection.text.trim() };
  if (!helper.status.checked) refreshHelper();
  if (question) ask(question);
  else helper.focusTick++;
}

export function closeHelper() {
  helper.open = false;
}

export function toggleHelper(options) {
  if (helper.open && !options?.selection) closeHelper();
  else openHelper(options);
}

export function newChat() {
  stop();
  helper.thread = [];
  helper.selection = null;
  helper.focusTick++;
}

// --- What the helper is told about the page --------------------------------------------------

export function currentExercise() {
  return store.route.page === "exercise" ? course.exercises.find((e) => e.id === store.route.id) ?? null : null;
}

// The file the learner has open, if there's one to share, and which version it is: theirs (the
// sandbox's), the solution they're peeking at, or the starter (Local mode, or before the
// sandbox is ready, when their own copy isn't in the page).
export function sharedFile() {
  if (!currentExercise()) return null;
  const editor = editorContext();
  if (!editor?.path || !editor.text?.trim()) return null;
  const live = effectiveMode() === "browser" && store.sandbox.state === "ready";
  const view = editor.view === "solution" ? "solution" : live ? "mine" : "starter";
  return { path: editor.path, text: editor.text, view };
}

// A question from the guide carries its step ({ exercise, beat, title }) instead of the panel's
// selection.
function pageContext(step = null) {
  const exercise = currentExercise();
  const context = { mode: effectiveMode(), page: store.route.page };
  if (exercise) context.exercise = exercise.id;
  if (step) {
    context.exercise = step.exercise;
    context.step = { id: step.beat, title: step.title };
  } else if (helper.selection) context.selection = { ...helper.selection };
  const file = helper.includeCode ? sharedFile() : null;
  if (file) context.file = file;
  return context;
}

// The chips under a question: what went with it.
function attachedLabels(context) {
  const labels = [];
  const exercise = currentExercise();
  if (context.step) labels.push(context.step.title);
  else if (exercise) labels.push(`Exercise ${exercise.number} · ${exercise.title}`);
  if (context.file) labels.push(context.file.path.split("/").pop());
  if (context.selection) labels.push(`Selection from the ${context.selection.source}`);
  return labels;
}

// --- Asking ---------------------------------------------------------------------------------------

let controller = null;

export function stop() {
  controller?.abort();
  controller = null;
}

// Asks in the panel, or, with a step, in the guide.
export async function ask(text, { step = null } = {}) {
  const question = String(text ?? "").trim();
  if (!question || helper.busy) return;
  const context = pageContext(step);
  const thread = step ? helper.guide : helper.thread;
  thread.push({ id: newId(), role: "user", content: question, attached: attachedLabels(context), selection: context.selection ?? null, step });
  if (!step) helper.selection = null;
  await stream(thread, context, step);
}

// Asks again: a thread's last question, after the learner connected the docs or signed in.
export async function retry(thread = helper.thread) {
  const last = thread.at(-1);
  if (last?.role === "assistant" && last.state !== "streaming") thread.pop();
  const question = thread.at(-1);
  if (question?.role !== "user") return;
  const context = pageContext(question.step);
  if (question.selection) context.selection = question.selection;
  await stream(thread, context, question.step);
}

// Whichever thread is waiting on the docs being connected.
function retryWaiting() {
  const thread = [helper.guide, helper.thread].find((t) => t.at(-1)?.error?.code === "verify");
  if (thread) retry(thread);
}

// The guide's earlier turns are the same exercise's: its steps build on each other.
async function stream(thread, context, step = null) {
  thread.push({ id: newId(), role: "assistant", content: "", sources: [], searches: [], state: "streaming", error: null, step });
  const reply = thread.at(-1);
  const history = thread
    .slice(0, -1)
    .filter((m) => m.content && !m.error && (!step || m.step?.exercise === step.exercise))
    .map((m) => ({ role: m.role, content: m.content }));
  helper.busy = true;
  controller = new AbortController();
  try {
    const response = await fetch("/api/helper/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ messages: history, context }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      fail(reply, data.error || `HTTP ${response.status}`, data.code);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            apply(reply, JSON.parse(line.slice(6)));
          } catch {
            /* a malformed event */
          }
        }
      }
    }
    if (reply.state === "streaming") reply.state = reply.content ? "done" : "stopped";
  } catch (err) {
    if (err.name === "AbortError") reply.state = "stopped";
    else fail(reply, "The helper isn't reachable right now. Check your connection and try again.");
  } finally {
    helper.busy = false;
    controller = null;
  }
}

function apply(reply, event) {
  if (event.type === "delta") reply.content += event.text;
  else if (event.type === "sources") reply.sources = event.sources;
  else if (event.type === "search") {
    const known = reply.searches.find((s) => s.id === event.id);
    if (known) Object.assign(known, event);
    else reply.searches.push({ id: event.id, query: event.query, state: event.state, count: event.count ?? null });
  } else if (event.type === "done") reply.state = "done";
  else if (event.type === "error") fail(reply, event.message, event.code);
}

function fail(reply, message, code = null) {
  reply.state = "error";
  reply.error = { message, code };
  if (code === "verify") helper.status = { ...helper.status, docs: "connect" };
  if (code === "access") helper.status = { ...helper.status, signedIn: false };
}

// --- Connecting the docs (Kapa's one-time "are you human?") --------------------------------

const RETRY_KEY = "helper-retry-after-connect";
let popupTimer = 0;

export function connectDocs() {
  const url = `/api/helper/connect?return=${encodeURIComponent(window.location.hash || "#/")}`;
  const width = 520;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(url, "temporal-docs-connect", `popup,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) {
    // Popups blocked: go there and come back.
    save(RETRY_KEY, true);
    window.location.href = url;
    return;
  }
  helper.connecting = true;
  clearInterval(popupTimer);
  popupTimer = setInterval(() => {
    if (popup.closed) {
      clearInterval(popupTimer);
      helper.connecting = false;
    }
  }, 600);
}

window.addEventListener("message", async (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "course-helper-connected") return;
  helper.connecting = false;
  clearInterval(popupTimer);
  if (!event.data.ok) {
    toast(`Couldn't connect the docs: ${event.data.message}`, 4200);
    return;
  }
  await refreshHelper();
  toast("Temporal docs connected", 2400);
  retryWaiting();
});

export async function disconnectDocs() {
  await api("/api/helper/connect", { method: "DELETE" }).catch(() => {});
  await refreshHelper();
  toast("Disconnected from the Temporal docs");
}

// After the no-popup route: back on the page, open the panel and ask again.
export async function resumeAfterConnect() {
  if (!load(RETRY_KEY, false)) return;
  save(RETRY_KEY, null);
  const status = await refreshHelper();
  if (status.docs !== "ready") return;
  if (helper.thread.at(-1)?.error?.code === "verify") helper.open = true;
  retryWaiting();
}

// --- Suggestions ------------------------------------------------------------------------------

const GENERAL = [
  "What is durable execution, in plain words?",
  "What's the difference between a workflow and an activity?",
  "What is a task queue, and how do workers use it?",
  "Why do agents need durable execution?",
];

export function suggestions() {
  const exercise = currentExercise();
  return exercise?.questions?.length ? exercise.questions : GENERAL;
}

// The questions a guide's step can be asked about, and what's been asked there.
export function stepPrompts(kind) {
  if (kind === "check") return ["What does the check test?", "My check failed: what should I look at?"];
  if (kind === "intro" || kind === "plain") return ["Explain this in simpler terms", "Why does this matter for agents?"];
  return ["Explain this step in more detail", "Why does this work?", "I'm stuck: where should I look?"];
}

export function stepThread(exercise, beat) {
  return helper.guide.filter((m) => m.step?.exercise === exercise && m.step?.beat === beat);
}

// Quick questions about a selection, by where it came from.
export function selectionPrompts(source) {
  if (source === "terminal") return ["What does this error mean?", "How do I fix it?", "Explain this output"];
  if (source === "editor") return ["Explain this code", "Why is it written this way?", "What could go wrong here?"];
  return ["Explain this in more detail", "Why does this matter?", "Show me an example"];
}
