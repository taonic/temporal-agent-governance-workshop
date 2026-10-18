<script setup>
// An exercise's assignment, as a conversation with a guide: one beat at a time (the intro, a
// background section, a step, the stretch, the check), with the earlier ones folded into a
// trail you can go back to. The learner answers with quick replies ("Done, next step") and can
// ask about the step they're on: the question goes to Ask Temporal with the step attached, and
// the answer appears under the step. Links and buttons in a step act on the page: a localhost
// link opens a pane, a file name opens the file, ▶ types a snippet into a terminal.
//
// The first time, the guide starts with getting started: Ask Temporal's setup (with only the
// guide on the page), then the workspace and its tour. The exercise's code tour comes at the end
// of its briefing, just before step 1, or after the beat its `tourAfter` names.
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { closeCodeTour, startCodeTour } from "../codeTour.js";
import { ask, helper, refreshHelper, sharedFile, stepPrompts, stepThread, stop } from "../helper.js";
import {
  course,
  effectiveMode,
  insertIntoEditor,
  revertFromEditor,
  load,
  navigate,
  openFile,
  openPane,
  openSessionTab,
  openTrip,
  openWorkflow,
  runInTerminal,
  save,
  sendToAgent,
  startAgentSession,
  startTrip,
  store,
  toast,
  restartWorker,
  runWorkerCommand,
  sandboxStartView,
  startSandbox,
  stopWorker,
  toggleWorker,
  tripView,
  workerRestartView,
  workerRunView,
  workerToggleView,
} from "../store.js";
import { findSnippet } from "../snippets.js";
import { streamIn } from "../streaming.js";
import AskSetupCard from "./AskSetupCard.vue";

// Answers bring Markdown and highlighting with them: loaded with the first question.
const AskMessage = defineAsyncComponent(() => import("./AskMessage.vue"));

const props = defineProps({
  exercise: { type: Object, required: true },
  live: { type: Boolean, default: false },
});
const emit = defineEmits(["check", "solve", "reset"]);

const mode = computed(() => effectiveMode());
const page = computed(() => props.exercise.modes[mode.value]);
// Getting started, until it's done once (in whichever exercise the learner starts): kept in the
// beats for the rest of the visit, so the trail can go back to it.
const GETTING_STARTED = [
  { id: "start-ask", kind: "onboard", title: "Set up Ask Temporal", html: "" },
  {
    id: "start-workspace",
    kind: "onboard",
    title: "Your workspace",
    html:
      "<p>You work on the left: your code, two terminals (one runs the worker, one is for everything else), and your sandbox's Temporal UI. I stay here on the right, a step at a time, and bring forward whatever a step needs.</p>" +
      "<p>Want a quick look around first?</p>",
  },
];
const gettingStarted = ref(!load("onboarded", false));
const beats = computed(() => [
  ...(gettingStarted.value ? GETTING_STARTED : []),
  { id: "intro", kind: "intro", title: "Introduction", html: page.value.intro },
  ...page.value.sections,
]);
const steps = computed(() => beats.value.filter((b) => b.kind === "step"));
const ticked = ref(load(`steps:${props.exercise.id}`, {}));
const done = computed(() => steps.value.filter((s) => ticked.value[s.id]).length);
const passed = computed(() => store.passed.includes(props.exercise.id));
const scroller = ref(null);
const input = ref(null);
const draft = ref("");
const position = computed(() => course.exercises.findIndex((e) => e.id === props.exercise.id));
const next = computed(() => course.exercises[position.value + 1]);
const label = (e) => (e.optional ? "★ Capstone" : `Exercise ${e.number}`);

// --- Where the conversation is ------------------------------------------------------------

// Back where you left off; the first time, after the last step you ticked.
function restore() {
  const saved = beats.value.findIndex((b) => b.id === load(`guide:${props.exercise.id}`, null));
  if (saved >= 0) return saved;
  const last = beats.value.findLastIndex((b) => b.kind === "step" && ticked.value[b.id]);
  return last >= 0 ? Math.min(last + 1, beats.value.length - 1) : 0;
}
const at = ref(restore());
const beat = computed(() => beats.value[Math.min(at.value, beats.value.length - 1)]);
watch(() => beat.value?.id, (id) => (store.guideBeat = id ?? null), { immediate: true });
const isLast = computed(() => at.value >= beats.value.length - 1);

watch(
  () => props.exercise.id,
  () => {
    ticked.value = load(`steps:${props.exercise.id}`, {});
    gettingStarted.value = !load("onboarded", false);
    at.value = restore();
    draft.value = "";
  },
);
// A new beat starts at its top, even when it has questions under it already.
watch(at, () => {
  save(`guide:${props.exercise.id}`, beat.value.id);
  pinned = false;
  nextTick(() => scroller.value?.scrollTo({ top: 0 }));
});

function goTo(index) {
  at.value = Math.max(0, Math.min(index, beats.value.length - 1));
}

function tick(id, value = true) {
  ticked.value = { ...ticked.value, [id]: value };
  save(`steps:${props.exercise.id}`, ticked.value);
}

// Start over: the code back as the exercise starts (ExercisePage runs reset.sh), and the guide
// back to its first step, nothing ticked, the exercise no longer passed.
function startOver() {
  const file = props.exercise.files.find((f) => f.editable && !f.scratch)?.path;
  const steps = [
    file && `puts ${file} back as the exercise starts (your edits are saved in .learner-backup/ first)`,
    "ends the running sessions and clears the bookings",
    "takes you back to the first step",
  ].filter(Boolean);
  if (!window.confirm(`Start ${label(props.exercise).toLowerCase()} over?\n\nThis ${steps.join(", ")}.`)) return;
  if (mode.value === "browser" && !props.live) return toast("Start your sandbox first: the code to put back is in it.");
  ticked.value = {};
  save(`steps:${props.exercise.id}`, {});
  goTo(0);
  // Not un-celebrated: a poll before reset.sh removes the marker would throw the confetti again.
  store.passed = store.passed.filter((id) => id !== props.exercise.id);
  emit("reset");
}

// The last beat of the briefing (the intro and any background before step 1) offers the code
// tour, over the editor; step 1 is waiting behind it. An exercise's `tourAfter` names another beat.
const offersCodeTour = computed(() => {
  if (!props.exercise.tour?.length) return false;
  if (props.exercise.tourAfter) return beat.value.id === props.exercise.tourAfter;
  return beat.value.kind !== "step" && beats.value[at.value + 1] === steps.value[0];
});

function advance({ codeTour = offersCodeTour.value } = {}) {
  if (beat.value.kind === "step") tick(beat.value.id);
  if (beat.value.id === "start-workspace") save("onboarded", true);
  goTo(at.value + 1);
  if (codeTour) {
    nextTick(() => {
      store.workspaceView = "code";
      startCodeTour(props.exercise);
    });
  }
}

// --- Passed ------------------------------------------------------------------------------------

// The check step, once it passed: a big 🎉, the way on to the next exercise, and the check.
// When it passes now (ExercisePage celebrates it), the guide goes there.
const showPassed = computed(() => beat.value.kind === "check" && passed.value);
watch(
  () => store.celebrated.includes(props.exercise.id),
  (now, before) => {
    if (now && before === false) goTo(beats.value.findIndex((b) => b.kind === "check"));
  },
);

// --- The message streaming in ---------------------------------------------------------------

// Each beat's message types itself out the first time it's shown in a visit (streaming.js); the
// replies wait for it. Back to one already shown, it's simply there. A click finishes it.
const bubble = ref(null);
const streaming = ref(false);
const streamed = new Set();
let stream = null;
function startStream() {
  stream?.finish();
  const key = `${props.exercise.id}:${mode.value}:${beat.value.id}`;
  if (streamed.has(key)) return;
  streamed.add(key);
  nextTick(() => {
    streaming.value = true;
    stream = streamIn(bubble.value, { onDone: () => (streaming.value = false) });
  });
}
watch(() => `${props.exercise.id}:${mode.value}:${beat.value.id}`, startStream, { immediate: true });
onBeforeUnmount(() => stream?.finish());

// --- Getting started ------------------------------------------------------------------------

// Only the guide on the page while Ask Temporal is set up; the workspace arrives with its tour.
watch(() => beat.value.id, (id) => (store.guideOnly = id === "start-ask"), { immediate: true });
onBeforeUnmount(() => (store.guideOnly = false));

const askReady = computed(() => !helper.status.enabled || (helper.status.signedIn && helper.status.docs === "ready"));

// The page tour (App), and on to the exercise when it's over.
let touringPage = false;
function showAround() {
  closeCodeTour();
  touringPage = true;
  store.pageTourRequest++;
}
watch(
  () => store.pageTourOpen,
  (open) => {
    if (open || !touringPage) return;
    touringPage = false;
    if (beat.value.id === "start-workspace") advance();
  },
);

// --- The workspace tab a step needs ---------------------------------------------------------

// A step with an Insert button wants the editor; then whatever its first action shows: Code
// for one that runs in a terminal (the worker toggle, a trip, a ▶), so the terminals are in
// sight before you click, or the Agent UI or Temporal UI it links to or acts in; then the
// console, if it talks about it; then the editor, if it names one of the exercise's files.
// Otherwise the tab stays as it is (the step carries on where the last one was). Steps only:
// the intro and background sections mention the UI in passing. It moves the tab when you arrive
// at a step, never while you're on one (each button then shows its own tab when clicked).

// The step's first button that does something in the workspace, and the tab it shows.
const ACTION_VIEWS = [
  [/^data-(?:worker-toggle|trip|run)\b/, "code"], // the terminals, under Code
  [/^data-pane="(console|temporal)"/, null],
  [/^data-(?:send|new-session|agent-tour)\b/, "console"],
  [/^data-(?:session-tab|workflow-open)\b/, "temporal"],
];
const ACTION = /data-(?:worker-toggle|trip|run|send|new-session|agent-tour|session-tab|workflow-open)\b|data-pane="(?:console|temporal)"/;
function firstAction(html) {
  const found = html.match(ACTION)?.[0];
  if (!found) return null;
  for (const [pattern, view] of ACTION_VIEWS) {
    const match = found.match(pattern);
    if (match) return view ?? match[1];
  }
  return null;
}
function viewFor(b) {
  if (b.kind !== "step") return null;
  if (b.html.includes("data-insert=")) return "code";
  const acted = firstAction(b.html);
  if (acted) return acted;
  if (/\b(?:the|in the|its) console\b/i.test(b.html.replace(/<[^>]+>/g, " "))) return "console";
  if (b.html.includes('class="file-ref"')) return "code";
  return null;
}
watch(
  [() => beat.value.id, () => props.live],
  () => {
    const view = props.live && viewFor(beat.value);
    if (view) store.workspaceView = view;
  },
  { immediate: true },
);

// --- What the guide says -------------------------------------------------------------------

const stepTitle = (b) => b.title.replace(/^\d+\.\s*/, "");
const stepNumber = (b) => steps.value.indexOf(b) + 1;
const NEXT_UP = ["Nice. Next up:", "Good. Now:", "On to the next one:", "Great. Here's the next step:"];

const kicker = computed(() => {
  const b = beat.value;
  if (b.kind === "onboard") return `Getting started · ${GETTING_STARTED.indexOf(b) + 1} of ${GETTING_STARTED.length}`;
  if (b.kind === "intro") return label(props.exercise);
  if (b.kind === "step") return `Step ${stepNumber(b)} of ${steps.value.length}`;
  return { stretch: "Stretch", check: "Check", plain: "Background" }[b.kind] ?? "";
});

const heading = computed(() =>
  beat.value.kind === "intro" ? props.exercise.title : beat.value.kind === "check" ? "Check your work" : beat.value.kind === "onboard" ? beat.value.title : stepTitle(beat.value),
);

const lead = computed(() => {
  const b = beat.value;
  const before = beats.value.slice(0, at.value);
  if (b.id === "start-ask") return "Hi! Welcome to the workshop. Two quick things before we start: Ask Temporal, then your workspace.";
  if (b.id === "start-workspace") return "Now, where you'll work.";
  if (b.kind === "intro" && gettingStarted.value) return `You're all set. Here's ${label(props.exercise).toLowerCase()}: I'll take you through it one step at a time. Ask me anything about a step as you go.`;
  if (b.kind === "intro") return "Hi! I'll walk you through this exercise one step at a time. Ask me anything about a step as you go.";
  if (b.kind === "plain") return before.some((x) => x.kind === "step") ? "Before you move on:" : "A little background first.";
  if (b.kind === "stretch") return "That's every step. Got time left? Try this; it isn't graded.";
  if (b.kind === "check") return passed.value ? "Your check passed. 🎉 Run it again any time." : "Last thing: let's check your work.";
  const n = stepNumber(b);
  return n === 1 ? "Let's get going." : NEXT_UP[(n - 2) % NEXT_UP.length];
});

const nextLabel = computed(() => {
  const b = beat.value;
  const following = beats.value[at.value + 1];
  if (b.id === "start-ask") return askReady.value ? "Next →" : "Skip for now →";
  if (b.id === "start-workspace") return "Skip the tour →";
  if (offersCodeTour.value) return b.kind === "step" ? "Done · ✦ take the code tour →" : "✦ Take the code tour →";
  if (b.kind === "intro") return following?.kind === "step" ? "Let's start →" : "Next →";
  if (b.kind === "step") return following?.kind === "step" ? "Done, next step →" : "Done →";
  if (b.kind === "stretch") return "Continue →";
  return "Got it →";
});

function trailLabel(b) {
  if (b.kind === "onboard") return b.title;
  if (b.kind === "intro") return "Introduction";
  if (b.kind === "step") return `Step ${stepNumber(b)} · ${stepTitle(b)}`;
  return b.kind === "check" ? "Check" : b.title;
}

// --- Asking about the step ------------------------------------------------------------------

const askable = computed(() => helper.status.checked && helper.status.enabled);
if (!helper.status.checked) refreshHelper();

const thread = computed(() => stepThread(props.exercise.id, beat.value.id));
const quickQuestions = computed(() => (beat.value.kind === "intro" && props.exercise.questions?.length ? props.exercise.questions.slice(0, 3) : stepPrompts(beat.value.kind)));
const file = computed(() => (store.editorPath, store.fileTexts, sharedFile()));
const placeholder = computed(() => (beat.value.kind === "intro" ? "Ask me about this exercise…" : `Ask about “${heading.value}”…`));

function send(text = draft.value) {
  const question = text.trim();
  if (!question || helper.busy) return;
  draft.value = "";
  ask(question, { step: { exercise: props.exercise.id, beat: beat.value.id, title: beat.value.kind === "intro" ? "Introduction" : beat.value.title } });
  nextTick(() => {
    autosize();
    scrollToEnd(true);
  });
}

function onKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

function autosize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

// Follows a question and its streaming answer, unless the learner scrolled up to read. It
// watches the conversation's height, since the answer's renderer loads with the first one.
let pinned = false;
function onScroll() {
  const el = scroller.value;
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
function scrollToEnd(force = false) {
  const el = scroller.value;
  if (!el || !(force || pinned)) return;
  pinned = true;
  el.scrollTo({ top: el.scrollHeight });
}
const grows = new ResizeObserver(() => scrollToEnd());
const changes = new MutationObserver(observeChildren);
function observeChildren() {
  grows.disconnect();
  for (const child of scroller.value?.children ?? []) grows.observe(child);
}
onMounted(() => {
  observeChildren();
  changes.observe(scroller.value, { childList: true });
});
onBeforeUnmount(() => {
  grows.disconnect();
  changes.disconnect();
});

// --- The page actions inside a step ---------------------------------------------------------

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy: select the text instead.");
  }
}

// The worker toggles the build put in the instructions: the same view as WorkerToggle.vue, or
// after "restart the worker", a Restart.
function paintToggles() {
  const toggle = workerToggleView(props.live);
  const restart = workerRestartView(props.live);
  for (const button of scroller.value?.querySelectorAll("button[data-worker-toggle]") ?? []) {
    const restarts = "workerRestart" in button.dataset;
    const view = restarts ? restart : toggle;
    button.className = `worker-toggle is-${view.state}${restarts ? " is-restart" : ""}`;
    button.disabled = view.disabled;
    button.title = view.title;
    button.setAttribute("aria-pressed", String(view.state === "running"));
    button.querySelector(".wt-label").textContent = view.label;
    const action = button.querySelector(".wt-action");
    action.textContent = view.action;
    action.hidden = !view.action;
  }
}
watch([() => ({ ...store.worker }), () => props.live, page, beat], () => nextTick(paintToggles), { immediate: true });

// A worker command's ▶ (`uv run hello-worker`, a block of one) is a toggle too: Stop while the
// worker it starts is the one running. Another worker command's ▶ runs that one in its place
// (FLAKY=1 uv run hello-worker while the plain one runs).
function paintWorkerRuns() {
  for (const button of scroller.value?.querySelectorAll('button[data-run][data-target="worker"]') ?? []) {
    const commands = JSON.parse(button.dataset.run);
    if (commands.length !== 1) continue;
    const view = workerRunView(commands[0], props.live);
    const block = button.classList.contains("snippet-run");
    button.dataset.workerState = view.state;
    button.classList.toggle("is-running", view.state === "running");
    button.disabled = view.disabled;
    button.title = view.title;
    button.textContent =
      view.state === "running" ? (block ? "■ Stop worker" : "■") : view.state === "pending" ? (block ? "… Worker" : "…") : block ? "▶ Run in worker" : "▶";
    button.setAttribute("aria-label", view.state === "running" ? `Stop the worker (${commands[0]})` : `Run ${commands[0]} in the worker terminal`);
  }
}
watch([() => ({ ...store.worker }), () => props.live, page, beat], () => nextTick(paintWorkerRuns), { immediate: true });

// The Start my sandbox button the build put in place of a #sandbox link: the sandbox's state.
function paintSandboxButtons() {
  const view = sandboxStartView();
  for (const button of scroller.value?.querySelectorAll("button[data-sandbox-start]") ?? []) {
    button.className = `sandbox-start is-${view.state}`;
    button.textContent = view.label;
    button.disabled = view.disabled;
  }
}
watch([() => ({ ...store.sandbox }), () => store.authenticated, page, beat], () => nextTick(paintSandboxButtons), { immediate: true });

// The trip buttons the build put in place of `uv run hello-start …`: each trip's workflow.
function paintTrips() {
  for (const group of scroller.value?.querySelectorAll("[data-trip]") ?? []) {
    const view = tripView(group.dataset.trip, props.live);
    group.className = `trip-toggle is-${view.state}`;
    group.title = view.title;
    group.replaceChildren(
      element("span", { className: "tt-dot", ariaHidden: "true" }),
      element("span", { className: "tt-label", textContent: view.label }),
      ...view.actions.map((a) => {
        const button = element("button", { type: "button", className: `tt-action is-${a.act}`, textContent: a.label, title: a.title });
        button.dataset.tripAct = a.act;
        return button;
      }),
    );
  }
}
const element = (tag, props) => Object.assign(document.createElement(tag), props);
watch([() => store.trips, () => props.live, page, beat], () => nextTick(paintTrips), { immediate: true, deep: true });

// Each Insert button says whether its snippet is in the file now; if it is, it reverts it.
function snippetCode(button) {
  return button.closest(".snippet")?.querySelector("pre")?.innerText ?? "";
}
function paintInserts() {
  for (const button of scroller.value?.querySelectorAll("button[data-insert]") ?? []) {
    const path = button.dataset.insert;
    const name = path.split("/").pop();
    const inserted = props.live && Boolean(findSnippet(store.fileTexts[path], snippetCode(button)));
    button.classList.toggle("is-inserted", inserted);
    button.setAttribute("aria-pressed", String(inserted));
    const replace = button.dataset.insertMode === "replace";
    button.textContent = inserted ? `✓ In ${name} · Revert` : `← ${replace ? "Replace in" : "Insert into"} ${name}`;
    button.title = inserted
      ? `It's in ${path}: take it back out${{ todo: " (the TODO comes back)", replace: " (the original rule comes back)" }[button.dataset.insertMode] ?? ""}`
      : {
          todo: "Replace the TODO in",
          replace: "Replace the rule with this @id in",
          append: "Add it to the end of",
          cursor: "Insert it at the cursor in",
        }[button.dataset.insertMode] + ` ${path}`;
  }
}
watch([() => store.fileTexts, () => props.live, page, beat], () => nextTick(paintInserts), { immediate: true, deep: true });

// A link to one of the assignment's sections (`[Look inside](#5-look-inside-the-session)`, a
// heading's anchor on GitHub too): the guide goes to that beat; to the next one, as Done does.
function goToSection(target, event) {
  const id = target.getAttribute("href")?.slice(1);
  const i = beats.value.findIndex((b) => b.id === id);
  if (i < 0) return false;
  event.preventDefault();
  if (i === at.value + 1) advance({ codeTour: false });
  else goTo(i);
  return true;
}

function onClick(event) {
  const target = event.target.closest("a, button, code.file-ref");
  if (!target) return;
  if (target.matches("a[href^='#']") && goToSection(target, event)) return;
  if (target.matches("button[data-worker-toggle]")) {
    if ("workerRestart" in target.dataset) restartWorker(props.exercise);
    else toggleWorker(props.exercise);
  } else if (target.matches("button[data-sandbox-start]")) {
    startSandbox();
  } else if (target.matches("button[data-workflow-open]")) {
    if (!props.live) return toast("Start your sandbox to open it.");
    openWorkflow(target.dataset.workflowOpen, target.dataset.workflowTab);
  } else if (target.matches("button[data-trip-act]")) {
    const key = target.closest("[data-trip]").dataset.trip;
    if (target.dataset.tripAct === "open") openTrip(key);
    else startTrip(key);
  } else if (target.matches("a[data-pane], button[data-pane]")) {
    event.preventDefault();
    if (!props.live) return toast("Start your sandbox to open it.");
    openPane(target.dataset.pane, target.dataset.path);
  } else if (target.matches("button[data-send]")) {
    if (!props.live) return toast("Start your sandbox to talk to the agent.");
    sendToAgent(target.dataset.send);
  } else if (target.matches("button[data-session-tab]")) {
    if (!props.live) return toast("Start your sandbox to open the Temporal UI.");
    openSessionTab(target.dataset.sessionTab);
  } else if (target.matches("button[data-agent-tour]")) {
    if (!props.live) return toast("Start your sandbox to open the Agent UI.");
    store.agentTourRequest++;
  } else if (target.matches("button[data-new-session]")) {
    if (!props.live) return toast("Start your sandbox to open the Agent UI.");
    startAgentSession(target.dataset.newSession, target.dataset.posture);
  } else if (target.matches("a.code-ref")) {
    // In the editor, the lines highlighted; without a sandbox, GitHub (the link itself).
    if (props.live && openFile(target.dataset.file, target.dataset.lines)) event.preventDefault();
  } else if (target.matches("a[href^='#/']")) {
    event.preventDefault();
    navigate(target.getAttribute("href"));
  } else if (target.matches("button[data-run]")) {
    if (!props.live) return toast("Start your sandbox to run this.");
    const commands = JSON.parse(target.dataset.run);
    if (target.dataset.workerState === "running") stopWorker();
    else if (target.dataset.workerState) runWorkerCommand(commands[0]);
    else runInTerminal(target.dataset.target, commands);
  } else if (target.matches("button[data-insert]")) {
    const act = target.classList.contains("is-inserted") ? revertFromEditor : insertIntoEditor;
    act(target.dataset.insert, snippetCode(target), target.dataset.insertMode);
  } else if (target.matches("button[data-copy]")) {
    copy(target.closest(".snippet")?.querySelector("pre")?.innerText ?? "");
  } else if (target.matches("code.file-ref")) {
    if (!openFile(target.dataset.file)) copy(target.dataset.file);
  }
}
</script>

<template>
  <section class="workspace-panel instruction-panel guide-panel" aria-label="Instructions" data-tour="instructions">
    <header class="instruction-heading">
      <div class="instruction-heading-top">
        <p class="guide-heading-title" :title="exercise.teaser">
          {{ label(exercise) }} · {{ exercise.title }}
          <span v-if="passed" class="passed-badge" title="Your check passed">✓ passed</span>
        </p>
        <span v-if="steps.length" class="step-progress-count">{{ done }}/{{ steps.length }}</span>
        <button v-if="exercise.scripts.reset" class="guide-restart" type="button" title="Start this exercise over: its code as it starts, fresh sessions, back to the first step" @click="startOver">
          <span aria-hidden="true">↺</span> Start over
        </button>
      </div>
      <div v-if="steps.length" class="step-progress" role="group" :aria-label="`${done} of ${steps.length} steps done`">
        <button
          v-for="step in steps"
          :key="step.id"
          class="step-progress-seg"
          :class="{ filled: ticked[step.id], current: step === beat }"
          type="button"
          :title="`Step ${stepNumber(step)} · ${stepTitle(step)}${ticked[step.id] ? ' (done)' : ''}`"
          :aria-label="`Go to step ${stepNumber(step)}: ${stepTitle(step)}`"
          :aria-current="step === beat ? 'step' : undefined"
          @click="goTo(beats.indexOf(step))"
        />
      </div>
    </header>

    <div ref="scroller" class="instruction-content guide-thread" @click="onClick" @scroll.passive="onScroll">
      <details v-if="at > 0" :key="`trail-${beat.id}`" class="guide-trail">
        <summary>
          <span class="guide-trail-count">{{ at === 1 ? "1 earlier" : `${at} earlier` }}</span>
          <span class="guide-trail-last">✓ {{ trailLabel(beats[at - 1]) }}</span>
        </summary>
        <ol>
          <li v-for="(b, i) in beats.slice(0, at)" :key="b.id">
            <button type="button" class="guide-trail-item" :class="{ skipped: b.kind === 'step' && !ticked[b.id] }" @click="goTo(i)">
              <span class="guide-trail-mark" aria-hidden="true">{{ b.kind === "step" && !ticked[b.id] ? "○" : "✓" }}</span>{{ trailLabel(b) }}
            </button>
          </li>
        </ol>
      </details>

      <article :key="`${exercise.id}-${mode}-${beat.id}`" class="guide-msg" :class="`kind-${beat.kind}`">
        <span class="guide-avatar" aria-hidden="true">✦</span>
        <div ref="bubble" class="guide-bubble" :class="{ 'is-streaming': streaming }" @click="streaming && stream?.finish()">
          <!-- Passed: the 🎉, the way on, and the check, to run again. -->
          <div v-if="showPassed" class="guide-passed">
            <span class="guide-tada" aria-hidden="true">🎉</span>
            <span class="visually-hidden">{{ label(exercise) }} passed.</span>
            <a v-if="next" class="button button-primary guide-next" :href="`#/exercise/${next.id}`">On to {{ label(next) }}: {{ next.title }} →</a>
            <span v-else class="guide-finale">That's the whole workshop.</span>
            <button v-if="mode === 'browser'" class="button" type="button" :disabled="!live" @click="emit('check')">✓ Run the check again</button>
          </div>
          <template v-else>
          <p class="guide-lead">{{ lead }}</p>
          <p class="guide-kicker">{{ kicker }}<template v-if="beat.kind === 'intro' && exercise.minutes"> · ~{{ exercise.minutes }} min</template></p>
          <h2 class="guide-title">{{ heading }}</h2>
          <p v-if="beat.kind === 'intro' && exercise.teaser" class="exercise-meta">{{ exercise.teaser }}</p>
          <div class="guide-body markdown" v-html="beat.html" />
          <AskSetupCard v-if="beat.id === 'start-ask'" class="guide-body" />
          <div v-if="beat.kind === 'check' && mode === 'browser'" class="instruction-actions">
            <button class="button button-primary" type="button" :disabled="!live" @click="emit('check')">✓ Run the check</button>
            <button v-if="exercise.scripts.solve && !passed" class="button" type="button" :disabled="!live" title="Apply the official solution" @click="emit('solve')">Stuck? Solve it for me</button>
          </div>
          </template>
        </div>
      </article>

      <div v-if="thread.length" class="guide-qa">
        <AskMessage v-for="message in thread" :key="message.id" :message="message" :thread="helper.guide" />
      </div>

      <div v-show="!streaming" class="guide-replies" role="group" aria-label="Reply to the guide">
        <button v-if="at > 0" class="guide-reply is-quiet" type="button" @click="goTo(at - 1)">← Back</button>
        <template v-if="!isLast">
          <button v-if="beat.id === 'start-workspace'" class="guide-reply is-primary" type="button" @click="showAround">✦ Show me around</button>
          <button class="guide-reply" :class="{ 'is-primary': beat.id === 'start-ask' ? askReady : beat.id !== 'start-workspace', 'is-quiet': beat.id === 'start-workspace' }" type="button" @click="advance()">{{ nextLabel }}</button>
          <button v-if="offersCodeTour" class="guide-reply is-quiet" type="button" @click="advance({ codeTour: false })">Skip the code tour</button>
        </template>
        <template v-else-if="!showPassed">
          <button v-if="beat.kind === 'step' && !ticked[beat.id]" class="guide-reply" type="button" @click="tick(beat.id)">Mark this step done</button>
          <a v-if="next" class="guide-reply is-primary" :href="`#/exercise/${next.id}`">On to {{ label(next) }}: {{ next.title }} →</a>
          <span v-else class="guide-finale">That's the whole workshop. 🎉</span>
        </template>
      </div>

      <div v-if="askable && !thread.length && beat.kind !== 'onboard' && !showPassed" v-show="!streaming" class="guide-suggest" role="group" aria-label="Questions to ask about this">
        <span class="guide-suggest-label">Or ask me:</span>
        <button v-for="q in quickQuestions" :key="q" class="ask-chip" type="button" :disabled="helper.busy" @click="send(q)">{{ q }}</button>
      </div>
    </div>

    <footer v-if="askable" class="guide-composer">
      <form class="ask-input" @submit.prevent="send()">
        <span class="guide-composer-mark" aria-hidden="true">✦</span>
        <textarea ref="input" v-model="draft" rows="1" :placeholder="placeholder" aria-label="Ask about this step" @input="autosize" @keydown="onKeydown" />
        <button v-if="helper.busy" class="ask-send is-stop" type="button" title="Stop" aria-label="Stop" @click="stop">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
        </button>
        <button v-else class="ask-send" type="submit" :disabled="!draft.trim()" title="Ask (Enter)" aria-label="Ask">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
      <p class="guide-composer-note">
        Answered by Ask Temporal from Temporal's docs, knowing this step
        <template v-if="file">
          and
          <button class="link-button" type="button" :aria-pressed="helper.includeCode" :title="helper.includeCode ? 'Click to leave it out' : 'Click to send it with your question'" @click="helper.includeCode = !helper.includeCode">
            {{ helper.includeCode ? file.path.split("/").pop() : `not ${file.path.split("/").pop()}` }}
          </button>
        </template>
      </p>
    </footer>
  </section>
</template>
