<script setup>
// The exercise's files. In the browser the sandbox holds the real copy: editable files save
// to it (after a pause, or Cmd/Ctrl-S), and a file changed on disk (solve.sh, switch.py, the
// terminal) reloads, unless you have unsaved edits, which get a choice instead. Locally it's
// a viewer: the starter, or the official solution.
//
// Undo and redo (the buttons, Cmd/Ctrl-Z, Cmd/Ctrl-Shift-Z, Ctrl-Y) keep each file's history
// across tab switches, and a reload from the sandbox is one more step you can undo.
//
// With the sandbox live, Python files get the sandbox's language server (lsp.js): hover for
// docs and signatures, F12 to go to a definition, completion as you type.
import { basicSetup } from "codemirror";
import { indentWithTab, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { indentUnit, StreamLanguage } from "@codemirror/language";
import { Annotation, Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import { helper, openHelper } from "../helper.js";
import { createLsp } from "../lsp.js";
import { dedent, findSnippet, indentLines, ruleBlock, ruleId, shape, todoFor } from "../snippets.js";
import { codeTour, currentStop, startCodeTour } from "../codeTour.js";
import { api, registerHook, store, toast } from "../store.js";
import { tourRange } from "../tourRange.js";
import CodeTour from "./CodeTour.vue";
import MaximizeButton from "./MaximizeButton.vue";

const props = defineProps({
  exercise: { type: Object, required: true },
  live: { type: Boolean, default: false }, // the sandbox is ready: read and write its files
  local: { type: Boolean, default: false }, // the Local view: a viewer of the starter
  stamps: { type: Object, default: () => ({}) }, // path -> { mtime, size }, from the page's poll
  maximized: { type: Boolean, default: false }, // the code panel over the whole workspace
  maximizable: { type: Boolean, default: false }, // its own expand button (Local; in the browser it's on the workspace tabs)
  shown: { type: Boolean, default: true }, // the workspace's Code tab is showing
});
const emit = defineEmits(["update:maximized"]);

// The exercise's files, then any the instructions opened to show you (the harness's code): those
// are read-only, from the sandbox, until you close them.
const extra = ref([]);
const files = computed(() => [...props.exercise.files, ...extra.value]);
// A file whose config names beats (`beats`) has a tab only on those beats of the guide, so a
// step shows the files it uses; the file that's open always has one (a link or the code tour
// can open any of them).
const onBeat = (file) => !file.beats || !store.guideBeat || file.beats.includes(store.guideBeat);
const firstOnBeat = () => (files.value.find(onBeat) ?? files.value[0])?.path ?? "";
const tabs = computed(() => files.value.filter((file) => onBeat(file) || file.path === active.value));
const active = ref(firstOnBeat());
// "mine": your copy (the sandbox's, or the starter while it isn't ready); "solution".
const view = ref("mine");
const docs = reactive({}); // path -> { text, saved, stamp, loading, saving, conflict }
const host = ref(null);
let editor = null;
let saveTimer = 0;
const editable = new Compartment();
const stats = ref({ lines: 0, chars: 0 });
const history = ref({ undo: 0, redo: 0 });
// Each file's editor state (with its undo history), by file, view and whether it's editable.
const states = new Map();
let shownKey = "";
// Marks a change that came from the sandbox's copy, so it isn't saved straight back.
const fromDisk = Annotation.define();
const flashing = ref(false);

const lsp = createLsp({
  async openPath(path) {
    if (!files.value.some((f) => f.path === path)) return null;
    select(path);
    await nextTick();
    return active.value === path ? editor : null;
  },
  notOpen: (path) => toast(`That's defined in ${path}, which isn't open here.`),
  // From a keyword argument's hover: Ask Temporal, with the line it's on attached.
  ask: (question, { text, path }) => openHelper({ selection: { text, source: "editor", path }, question }),
  canAsk: () => !(helper.status.checked && !helper.status.enabled),
});
// Your copy of a Python file, while the sandbox is live (the solution has no server behind it).
const languageServer = (path) =>
  props.live && view.value === "mine" && path.endsWith(".py") && !extra.value.some((f) => f.path === path) ? lsp.plugin(path) : [];

// The lines a snippet just went into, highlighted for a moment so you can see where; and, just
// before, the lines it's about to replace (`cls: "cm-outgoing"`).
const flash = StateEffect.define();
const flashField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(flash)) continue;
      if (!effect.value) return Decoration.none;
      const marks = [];
      const doc = tr.state.doc;
      for (let n = doc.lineAt(effect.value.from).number; n <= doc.lineAt(effect.value.to).number; n++) {
        marks.push(Decoration.line({ class: effect.value.cls ?? "cm-inserted" }).range(doc.line(n).from));
      }
      next = Decoration.set(marks);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// The code tour's chunk: its lines lit, the rest dimmed (by the shell's class, so it fades).
const spotlight = StateEffect.define();
const spotlightField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(spotlight)) continue;
      if (!effect.value) return Decoration.none;
      const { start, end } = effect.value;
      const marks = [];
      for (let n = start; n <= end; n++) {
        const edge = `${n === start ? " cm-tour-first" : ""}${n === end ? " cm-tour-last" : ""}`;
        marks.push(Decoration.line({ class: `cm-tour-line${edge}` }).range(tr.state.doc.line(n).from));
      }
      next = Decoration.set(marks);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const activeFile = computed(() => files.value.find((f) => f.path === active.value) ?? files.value[0]);
const doc = computed(() => docs[active.value]);
const canEdit = computed(() => props.live && view.value === "mine" && Boolean(activeFile.value?.editable));
const hasSolution = computed(() => typeof activeFile.value?.solution === "string");
const dirty = (path) => {
  const d = docs[path];
  return Boolean(d && d.text !== d.saved);
};
const statusText = computed(() => {
  const d = doc.value;
  if (view.value === "solution") return "The official solution (read-only)";
  if (props.local) return activeFile.value?.editable ? "The starter: edit it in your clone of the repo" : "Read-only";
  if (!props.live) return activeFile.value?.editable ? "The starter: start your sandbox to edit it" : "Read-only";
  if (!d || d.loading) return "Loading…";
  if (d.saving) return "Saving…";
  if (d.conflict) return "Changed on disk";
  if (!activeFile.value.editable) return "Read-only";
  return dirty(active.value) ? "Unsaved" : "Saved to your sandbox";
});

// A small highlighter for Dogwood (Cedar plus temporal conditions).
const dogwood = StreamLanguage.define({
  token(stream) {
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^@\w+/)) return "meta";
    if (stream.match(/^\d+(?:d|h|m|s)?\b/)) return "number";
    if (stream.match(/^(?:permit|forbid|when|unless|temporal|formerly|within|has|like|in|is|if|then|else|true|false|principal|action|resource|context)\b/)) return "keyword";
    if (stream.match(/^[A-Z]\w*(?=::)/)) return "typeName";
    if (stream.match(/^[\w]+/)) return "variableName";
    stream.next();
    return null;
  },
});

function language(path) {
  if (path.endsWith(".py")) return python();
  if (path.endsWith(".dw")) return dogwood;
  return [];
}

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13px", backgroundColor: "#0d0d10" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', lineHeight: "1.55" },
    ".cm-gutters": { backgroundColor: "#0d0d10", border: "none" },
    // The language server's hover docs: temporalio's signatures are long, so wrap and scroll.
    ".cm-lsp-hover-tooltip": {
      maxWidth: "min(42em, 80vw)",
      maxHeight: "18em",
      overflow: "auto",
      padding: "4px 10px",
      fontSize: "12px",
      lineHeight: "1.45",
      "& pre, & code": { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
      "& ul": { paddingLeft: "1.3em", margin: "4px 0" },
      // A scrollbar that stays visible (macOS hides overlay ones until you scroll), so long
      // docs look scrollable.
      "&::-webkit-scrollbar": { width: "10px", height: "10px" },
      "&::-webkit-scrollbar-track": { background: "transparent" },
      "&::-webkit-scrollbar-thumb": { background: "#5c6370", borderRadius: "5px", border: "2px solid #21252b" },
      "&::-webkit-scrollbar-thumb:hover": { background: "#7f8794" },
    },
    "&.cm-peeking .cm-tooltip-hover": { display: "none" },
    // A keyword argument's explanation, under its type, and the way to ask for more.
    ".cm-lsp-param-doc": {
      marginTop: "6px",
      paddingTop: "6px",
      borderTop: "1px solid #3e4451",
      fontFamily: "system-ui, sans-serif",
      fontSize: "12.5px",
      color: "#dcdfe4",
    },
    ".cm-lsp-param-source": { marginTop: "4px", color: "#7f8794", fontSize: "11.5px", "& code": { color: "#abb2bf" } },
    ".cm-lsp-ask": {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      margin: "8px 0 4px",
      padding: "3px 10px",
      border: "1px solid #4b5263",
      borderRadius: "999px",
      background: "#2c313a",
      color: "#e5e7eb",
      font: "500 12px system-ui, sans-serif",
      cursor: "pointer",
      "&:hover": { background: "#3a404b", borderColor: "#61afef" },
      "& span": { color: "#c678dd" },
      "& code": { color: "#e5c07b" },
    },
    // F12 on something outside the exercise's files: where it's defined, above its docs.
    ".cm-lsp-peek-where": {
      margin: "2px 0 4px",
      paddingBottom: "4px",
      borderBottom: "1px solid #3e4451",
      color: "#abb2bf",
      fontFamily: "system-ui, sans-serif",
      "& code": { color: "#e5c07b" },
    },
  },
  { dark: true },
);

function currentText() {
  if (view.value === "solution") return activeFile.value?.solution ?? "";
  return docs[active.value]?.text ?? activeFile.value?.starter ?? "";
}

function makeState(text) {
  return EditorState.create({
    doc: text,
    extensions: [
      basicSetup,
      keymap.of([
        indentWithTab,
        { key: "Mod-s", preventDefault: true, run: () => (saveNow(), true) },
        // basicSetup binds Mod-z (Cmd on a Mac); Ctrl works too, on every platform.
        { key: "Ctrl-z", preventDefault: true, run: undo },
        { key: "Ctrl-y", preventDefault: true, run: redo },
        { key: "Ctrl-Shift-z", preventDefault: true, run: redo },
      ]),
      language(active.value),
      languageServer(active.value),
      indentUnit.of("    "),
      oneDark,
      theme,
      editable.of([EditorState.readOnly.of(!canEdit.value), EditorView.editable.of(canEdit.value)]),
      flashField,
      spotlightField,
      EditorView.updateListener.of((update) => {
        countHistory(update.state);
        if (update.docChanged) countDoc(update.state.doc);
        if (!update.docChanged || !canEdit.value) return;
        if (update.transactions.some((tr) => tr.annotation(fromDisk))) return;
        const d = docs[active.value];
        if (!d) return;
        d.text = update.state.doc.toString();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 1200);
      }),
    ],
  });
}

function countDoc(doc) {
  stats.value = { lines: doc.lines, chars: doc.length };
}

function countHistory(state) {
  history.value = { undo: undoDepth(state), redo: redoDepth(state) };
}

// Shows the active file, reusing its editor state so its undo history carries over. If its
// text changed meanwhile (the sandbox's copy was reloaded), that arrives as an undoable edit.
function showCurrent() {
  if (!editor) return;
  if (shownKey) states.set(shownKey, editor.state);
  const key = `${active.value}|${view.value}|${canEdit.value}`;
  const text = currentText();
  const cached = states.get(key);
  // With nothing to undo there's nothing to keep: a fresh state (so the first load from the
  // sandbox isn't an undo step back to the starter).
  if (cached && undoDepth(cached) > 0) {
    editor.setState(cached);
    if (cached.doc.toString() !== text) {
      editor.dispatch({ changes: { from: 0, to: cached.doc.length, insert: text }, annotations: fromDisk.of(true) });
    }
  } else {
    editor.setState(makeState(text));
  }
  shownKey = key;
  countDoc(editor.state.doc);
  countHistory(editor.state);
  showStop();
}

// --- The code tour ----------------------------------------------------------------------------

const tourStop = computed(() => currentStop(props.exercise.id));
const touring = computed(() => Boolean(tourStop.value));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Spotlights the current stop in the file on show, and glides it into view, a little above the
// middle so the card doesn't cover it. Called again whenever the file's state is replaced.
function showStop() {
  if (!editor) return;
  const stop = tourStop.value;
  const range = stop && stop.file === active.value ? tourRange(editor.state.doc.toString(), stop) : null;
  editor.dispatch({ effects: spotlight.of(range) });
  codeTour.lines = range;
  if (!range) return;
  requestAnimationFrame(() => {
    if (!editor) return;
    const top = editor.lineBlockAt(editor.state.doc.line(range.start).from).top;
    editor.scrollDOM.scrollTo({ top: Math.max(0, top - editor.scrollDOM.clientHeight * 0.16), behavior: reducedMotion() ? "auto" : "smooth" });
  });
}

// Hidden behind another workspace tab, the editor can't measure itself: it does when it shows.
watch(
  () => props.shown,
  (shown) => shown && nextTick(() => (editor?.requestMeasure(), showStop())),
);

// A stop in another file opens it (your copy); showCurrent then spotlights it. The tour needs
// the editor, so it brings the Code tab forward.
watch(
  () => store.guideBeat,
  () => {
    const file = files.value.find((f) => f.path === active.value);
    if (file && !onBeat(file) && !touring.value) select(firstOnBeat());
  },
);

watch([tourStop, touring], ([stop]) => {
  if (stop) store.workspaceView = "code";
  if (stop && (stop.file !== active.value || view.value !== "mine")) select(stop.file);
  else showStop();
});

function forgetHistory() {
  states.clear();
  shownKey = "";
}

function runHistory(command) {
  if (!editor || !canEdit.value) return;
  command(editor);
  editor.focus();
}

// --- Inserting a snippet from the instructions ---------------------------------------------

function lineRange(from, to) {
  const doc = editor.state.doc;
  return [doc.lineAt(from).number, doc.lineAt(Math.max(from, to - 1)).number];
}

function highlight(from, to, { scroll = true } = {}) {
  editor.dispatch({ effects: [flash.of({ from, to }), ...(scroll ? [EditorView.scrollIntoView(from, { y: "center" })] : [])] });
  flashing.value = false;
  requestAnimationFrame(() => (flashing.value = true));
  setTimeout(() => {
    editor?.dispatch({ effects: flash.of(null) });
    flashing.value = false;
  }, 2600);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Where the scroller should be to show `from`..`to`: the block in the middle, or its first lines
// near the top when it's taller than the view. Lines off screen have estimated heights until
// CodeMirror draws them, so this is asked again on every frame of a scroll.
function scrollTargetFor(from, to) {
  const scroller = editor.scrollDOM;
  const top = editor.lineBlockAt(from).top;
  const bottom = editor.lineBlockAt(to).bottom;
  const view = scroller.clientHeight;
  const want = bottom - top < view * 0.8 ? top - (view - (bottom - top)) / 2 : top - view * 0.2;
  return Math.max(0, Math.min(scroller.scrollHeight - view, want));
}

// Scrolls the editor to show `from`..`to`, eased, over a time that grows with the distance
// (about 0.3 s for a short hop, at most 0.9 s from the top of a long file).
function scrollToSlowly(from, to = from) {
  const scroller = editor.scrollDOM;
  const start = scroller.scrollTop;
  const first = scrollTargetFor(from, to);
  if (Math.abs(first - start) < 4) return Promise.resolve();
  if (reducedMotion()) {
    scroller.scrollTop = first;
    return Promise.resolve();
  }
  const duration = Math.min(900, 300 + Math.abs(first - start) * 0.5);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  return new Promise((resolve) => {
    const began = performance.now();
    const step = (now) => {
      if (!editor) return resolve();
      const t = Math.min(1, (now - began) / duration);
      scroller.scrollTop = start + (scrollTargetFor(from, to) - start) * ease(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

// Puts a snippet into a file: in place of the exercise's TODO block when it's the solution
// to it, at the end of a policy when it's another rule, or at the cursor. Returns a message.
// It takes its time, so you see where it goes and what it replaces: the editor scrolls there,
// marks the lines about to go, waits a moment, then puts the snippet in.
async function insertSnippet(path, code, mode, { retried = false } = {}) {
  const file = files.value.find((f) => f.path === path);
  if (!file?.editable) return "That file isn't editable here.";
  if (!props.live) return "Start your sandbox first: the editor saves to it.";
  if (active.value !== path || view.value !== "mine") {
    active.value = path;
    view.value = "mine";
    await nextTick();
  }
  if (docs[path]?.text === undefined) await loadFile(path, { force: true });
  showCurrent();
  const text = editor.state.doc.toString();
  const lines = dedent(code);
  const name = path.split("/").pop();

  // Already there? Show it instead of adding a second copy.
  if (shape(text).includes(shape(code))) {
    const first = lines.find((l) => l.trim())?.trim() ?? "";
    const at = text.indexOf(first);
    if (at >= 0) {
      const end = text.indexOf("\n", at + 1);
      await scrollToSlowly(at, end < 0 ? text.length : end);
      highlight(at, end < 0 ? text.length : end, { scroll: false });
    }
    return `That's already in ${name}.`;
  }

  let from;
  let to;
  let insert;
  let where;
  // The TODO block this snippet solves (a file can have several), or the first still open.
  const todo = mode === "todo" ? (todoFor(file.todos, code) ?? file.todos?.find((t) => text.includes(t.starter))) : null;
  const todoAt = todo ? text.indexOf(todo.starter) : -1;
  const marker = `TODO(ch${String(props.exercise.number).padStart(2, "0")})`;
  if (todoAt >= 0) {
    from = todoAt;
    to = todoAt + todo.starter.length;
    insert = `${indentLines(lines, todo.starter.match(/^[ \t]*/)[0])}\n`;
    where = "in place of the TODO";
  } else if (mode === "replace" && ruleBlock(text, ruleId(code))) {
    const block = ruleBlock(text, ruleId(code));
    from = block.start;
    to = block.end;
    insert = indentLines(lines, "");
    where = `in place of the rule ${ruleId(code)}`;
  } else if (mode === "append" || mode === "replace") {
    // A rule to replace that isn't there any more goes at the end, as a new one.
    from = to = text.length;
    insert = `${text.endsWith("\n") ? "\n" : "\n\n"}${indentLines(lines, "")}\n`;
    where = "at the end";
  } else if (mode === "todo" && text.includes(marker)) {
    const line = editor.state.doc.lineAt(text.indexOf(marker));
    from = to = line.from;
    insert = `${indentLines(lines, line.text.match(/^[ \t]*/)[0])}\n`;
    where = "above the TODO (you'd edited it, so remove what it replaces)";
  } else {
    const selection = editor.state.selection.main;
    const line = editor.state.doc.lineAt(selection.from);
    from = selection.from;
    to = selection.to;
    insert = indentLines(lines, from === line.from ? line.text.match(/^[ \t]*/)[0] : "");
    where = "at the cursor";
  }

  await scrollToSlowly(from, to);
  if (to > from) {
    editor.dispatch({ effects: flash.of({ from, to: Math.max(from, to - 1), cls: "cm-outgoing" }) });
    await pause(1100);
  } else {
    await pause(350);
  }
  // Changed meanwhile (typing, or the sandbox's copy reloading): start over on what's there now.
  if (!editor || editor.state.doc.toString() !== text) {
    editor?.dispatch({ effects: flash.of(null) });
    return retried ? "The file changed while it was going in: try again." : insertSnippet(path, code, mode, { retried: true });
  }

  const lead = insert.match(/^\n*/)[0].length;
  editor.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
  const start = from + lead;
  const end = from + insert.replace(/\n+$/, "").length;
  highlight(start, end, { scroll: false });
  await scrollToSlowly(start, end); // the new lines, without a jump
  const [a, b] = lineRange(start, end);
  return `Inserted into ${name} ${where}: line${a === b ? ` ${a}` : `s ${a}–${b}`}.`;
}

// Takes an inserted snippet back out: a solution gives way to the exercise's TODO block again;
// a policy rule or a cursor insert is removed. An ordinary edit, so it can be undone too.
async function revertSnippet(path, code, mode) {
  const file = files.value.find((f) => f.path === path);
  if (!file?.editable) return "That file isn't editable here.";
  if (!props.live) return "Start your sandbox first: the editor saves to it.";
  if (active.value !== path || view.value !== "mine") {
    active.value = path;
    view.value = "mine";
    await nextTick();
  }
  if (docs[path]?.text === undefined) await loadFile(path, { force: true });
  showCurrent();
  const text = editor.state.doc.toString();
  const name = path.split("/").pop();
  const found = findSnippet(text, code);
  if (!found) return `It isn't in ${name} as inserted any more, so there's nothing to revert.`;

  const outside = text.slice(0, found.start) + text.slice(found.end);
  // Its TODO comes back, unless it's still there (the snippet went in above an edited TODO).
  const todo = mode === "todo" ? todoFor(file.todos, code) : null;
  if (todo && !outside.includes(todo.starter.trim().split("\n")[0].trim())) {
    const restore = todo.starter.replace(/\n$/, "");
    editor.dispatch({ changes: { from: found.start, to: found.end, insert: restore }, selection: { anchor: found.start } });
    highlight(found.start, found.start + restore.length);
    const [a, b] = lineRange(found.start, found.start + restore.length);
    return `Reverted: the TODO is back in ${name}, line${a === b ? ` ${a}` : `s ${a}–${b}`}.`;
  }
  // A replaced rule: the rule as the exercise starts comes back.
  const original = mode === "replace" ? ruleBlock(file.starter, ruleId(code)) : null;
  if (original) {
    const restore = file.starter.slice(original.start, original.end);
    editor.dispatch({ changes: { from: found.start, to: found.end, insert: restore }, selection: { anchor: found.start } });
    highlight(found.start, found.start + restore.length);
    const [a, b] = lineRange(found.start, found.start + restore.length);
    return `Reverted: the original rule is back in ${name}, line${a === b ? ` ${a}` : `s ${a}–${b}`}.`;
  }
  // Remove the lines, and the blank line an append put before them.
  let from = found.start;
  let to = found.end < text.length && text[found.end] === "\n" ? found.end + 1 : found.end;
  if (mode === "append" && from >= 2 && text.slice(from - 2, from) === "\n\n") from -= 1;
  editor.dispatch({ changes: { from, to }, selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
  return `Reverted: removed it from ${name}.`;
}

async function loadFile(path, { force = false } = {}) {
  if (!props.live) return;
  const existing = docs[path];
  if (existing && !force && (existing.loading || existing.text !== undefined)) return;
  docs[path] = { ...(existing ?? {}), loading: true, conflict: false };
  try {
    const { content } = await api(`/api/files?path=${encodeURIComponent(path)}`);
    docs[path] = { text: content, saved: content, stamp: props.stamps[path] ?? null, loading: false, saving: false, conflict: false };
  } catch (err) {
    docs[path] = { ...(docs[path] ?? {}), loading: false };
    toast(`Couldn't open ${path}: ${err.message}`);
  }
  if (path === active.value) showCurrent();
}

async function saveNow() {
  clearTimeout(saveTimer);
  const path = active.value;
  const d = docs[path];
  if (!d || !canEdit.value || d.text === d.saved || d.saving) return;
  const text = d.text;
  d.saving = true;
  try {
    await api("/api/files", { method: "PUT", body: { path, content: text } });
    d.saved = text;
    d.conflict = false;
  } catch (err) {
    toast(`Couldn't save ${path}: ${err.message}`);
  } finally {
    d.saving = false;
  }
  if (d.text !== d.saved) saveTimer = setTimeout(saveNow, 1200);
}

// Something else changed a file: reload it, unless it's what we just saved, or there are
// unsaved edits (then ask).
async function onStampChange(path, stamp) {
  const d = docs[path];
  if (!d || d.loading || d.saving || d.text === undefined) return;
  if (d.stamp && stamp && d.stamp.mtime === stamp.mtime && d.stamp.size === stamp.size) return;
  let content;
  try {
    ({ content } = await api(`/api/files?path=${encodeURIComponent(path)}`));
  } catch {
    return;
  }
  d.stamp = stamp;
  if (content === d.saved) return;
  if (d.text === d.saved) {
    d.text = content;
    d.saved = content;
    if (path === active.value && view.value === "mine") showCurrent();
    toast(`${path} changed in your sandbox, so it was reloaded.`);
  } else {
    d.conflict = content;
  }
}

function takeDisk() {
  const d = doc.value;
  d.text = d.conflict;
  d.saved = d.conflict;
  d.conflict = false;
  showCurrent();
}

function keepMine() {
  const d = doc.value;
  d.saved = d.conflict; // so the next save overwrites the disk copy
  d.conflict = false;
  saveNow();
}

function select(path) {
  saveNow();
  active.value = path;
  view.value = "mine";
}

// From the instructions: a file, and lines in it to show ("321-335"), selected and flashed. A
// file that isn't the exercise's opens as a read-only tab, from the sandbox.
function openAt(path, lines) {
  if (!files.value.some((f) => f.path === path)) {
    if (!props.live || !lines) return false;
    extra.value = [...extra.value, { path }];
  }
  select(path);
  if (lines) reveal(path, lines);
  return true;
}

async function reveal(path, lines) {
  await loadFile(path);
  await nextTick();
  if (!editor || active.value !== path) return;
  const doc = editor.state.doc;
  const [first, last = first] = lines.split("-").map((n) => Math.min(Math.max(1, Number(n)), doc.lines));
  const from = doc.line(first).from;
  const to = doc.line(last).to;
  editor.dispatch({ selection: { anchor: from, head: to } });
  highlight(from, to);
  // From its top, so a range that fits is all in view (highlight centres its first line).
  editor.dispatch({ effects: EditorView.scrollIntoView(from, { y: "start", yMargin: 24 }) });
}

function closeExtra(path) {
  extra.value = extra.value.filter((f) => f.path !== path);
  if (active.value === path) select(props.exercise.files[0]?.path ?? "");
}
watch(
  () => props.exercise.id,
  () => (extra.value = []),
);

// Each file's current text, for the instructions' Insert/Revert buttons.
watch(
  docs,
  () => {
    store.fileTexts = Object.fromEntries(Object.entries(docs).filter(([, d]) => typeof d.text === "string").map(([path, d]) => [path, d.text]));
  },
  { deep: true },
);

watch([active, view], () => {
  loadFile(active.value);
  showCurrent();
});

watch(
  () => props.live,
  (live) => {
    if (live) lsp.start();
    else lsp.stop();
    if (live) for (const file of files.value) loadFile(file.path);
    else {
      for (const key of Object.keys(docs)) delete docs[key];
      forgetHistory();
    }
    showCurrent();
  },
);

watch(
  () => props.stamps,
  (stamps) => {
    for (const [path, stamp] of Object.entries(stamps)) onStampChange(path, stamp);
  },
  { deep: true },
);

watch(
  () => props.exercise.id,
  () => {
    saveNow();
    forgetHistory();
    active.value = firstOnBeat();
    view.value = "mine";
    if (props.live) for (const file of files.value) loadFile(file.path);
    showCurrent();
    // A new exercise starts at the top, not wherever the last one was scrolled to.
    if (editor) editor.scrollDOM.scrollTop = 0;
  },
);

let unregister = null;
let unregisterInsert = null;
let unregisterRevert = null;
let unregisterEditor = null;
// The tab on show, for Ask Temporal's "send my code" chip.
watch([active, view], () => (store.editorPath = `${active.value}|${view.value}`), { immediate: true });
onMounted(() => {
  editor = new EditorView({ state: makeState(currentText()), parent: host.value });
  shownKey = `${active.value}|${view.value}|${canEdit.value}`;
  countDoc(editor.state.doc);
  if (props.live) {
    lsp.start();
    for (const file of files.value) loadFile(file.path);
  }
  unregister = registerHook("file", openAt);
  unregisterInsert = registerHook("insert", insertSnippet);
  unregisterRevert = registerHook("revert", revertSnippet);
  // For Ask Temporal: the file on show, and what's selected in it.
  unregisterEditor = registerHook("editor", () => {
    if (!editor) return null;
    const { from, to } = editor.state.selection.main;
    return { path: active.value, text: editor.state.doc.toString(), view: view.value, selection: editor.state.sliceDoc(from, to), editable: Boolean(activeFile.value?.editable) };
  });
  window.addEventListener("beforeunload", saveNow);
});

onBeforeUnmount(() => {
  saveNow();
  lsp.stop();
  editor?.destroy();
  unregister?.();
  unregisterInsert?.();
  unregisterRevert?.();
  unregisterEditor?.();
  store.fileTexts = {};
  store.editorPath = "";
  window.removeEventListener("beforeunload", saveNow);
});
</script>

<template>
  <div class="code-editor" data-tour="editor">
    <div class="file-tabs" role="tablist" aria-label="Exercise files">
      <button
        v-for="file in tabs"
        :key="file.path"
        class="file-tab"
        :class="{ active: file.path === active, dirty: dirty(file.path), locked: !file.editable }"
        type="button"
        role="tab"
        :title="file.editable ? `${file.path} (your TODO is here)` : `${file.path} (read-only)`"
        @click="select(file.path)"
      >
        {{ file.path.split("/").pop() }}<span v-if="!file.editable" class="lock" aria-hidden="true"> 🔒</span>
        <span
          v-if="extra.some((f) => f.path === file.path)"
          class="tab-close"
          role="button"
          :aria-label="`Close ${file.path.split('/').pop()}`"
          title="Close"
          @click.stop="closeExtra(file.path)"
          >✕</span
        >
      </button>
      <div class="file-tabs-end">
      <div class="history-btns" role="group" aria-label="Undo and redo">
        <button class="history-btn" type="button" :disabled="!canEdit || !history.undo" title="Undo (⌘Z / Ctrl+Z)" aria-label="Undo" @click="runHistory(undo)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
        </button>
        <button class="history-btn" type="button" :disabled="!canEdit || !history.redo" title="Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)" aria-label="Redo" @click="runHistory(redo)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
        </button>
      </div>
      <button
        v-if="exercise.tour?.length"
        class="view-tab"
        :class="{ active: touring }"
        type="button"
        title="A tour of this exercise's code, a chunk at a time"
        @click="startCodeTour(exercise)"
      >
        Code tour
      </button>
      <button
        v-if="hasSolution"
        class="view-tab"
        data-tour="solution-toggle"
        :class="{ active: view === 'solution' }"
        type="button"
        @click="view = view === 'solution' ? 'mine' : 'solution'"
      >
        {{ view === "solution" ? "Back to your code" : "Peek at the solution" }}
      </button>
      <div v-if="maximizable" class="file-tabs-maximize">
        <MaximizeButton :maximized="maximized" what="the code" @toggle="emit('update:maximized', !maximized)" />
      </div>
      </div>
    </div>
    <div v-if="doc?.conflict && view === 'mine'" class="editor-banner">
      <span><strong>{{ active }}</strong> changed in your sandbox while you had unsaved edits.</span>
      <button class="button" type="button" @click="takeDisk">Use the sandbox's version</button>
      <button class="button" type="button" @click="keepMine">Keep mine</button>
    </div>
    <div class="editor-shell" :class="{ flashing, touring }">
      <div ref="host" class="code-mirror-host" />
      <CodeTour :exercise-id="exercise.id" />
    </div>
    <div class="editor-footer">
      <span>{{ stats.lines }} lines - {{ stats.chars }} chars</span>
      <span>{{ activeFile?.path }} · {{ statusText }}</span>
    </div>
  </div>
</template>
