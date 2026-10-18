<script setup>
// "✦ Ask" beside a selection: in the instructions or a page (the browser's selection), the
// editor (CodeMirror's), or a terminal (xterm's, which isn't a DOM selection). Clicking it
// opens Ask Temporal with the selection attached.
import { onBeforeUnmount, onMounted, ref } from "vue";

import { helper, openHelper } from "../helper.js";
import { editorContext, terminalSelection } from "../store.js";

const shown = ref(null); // { text, source, path, x, y }

const MIN = 2;
const MAX = 8000;

function place(x, y) {
  const width = 92;
  return { x: Math.min(Math.max(8, x - width / 2), window.innerWidth - width - 8), y: y < 56 ? y + 28 : y - 40 };
}

function read(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(".ask-panel, .ask-float")) return null;
  if (target.closest(".terminal-host")) {
    const text = terminalSelection();
    return text.trim().length >= MIN ? { text, source: "terminal", ...place(event.clientX, event.clientY) } : null;
  }
  if (target.closest(".code-mirror-host")) {
    const editor = editorContext();
    const text = editor?.selection ?? "";
    return text.trim().length >= MIN ? { text, source: "editor", path: editor.path, ...place(event.clientX, event.clientY) } : null;
  }
  if (!target.closest(".instruction-content, .reading")) return null;
  const selection = window.getSelection();
  const text = selection?.toString() ?? "";
  if (!selection || selection.isCollapsed || text.trim().length < MIN) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return { text, source: "instructions", ...place(rect.left + rect.width / 2, rect.top) };
}

function onUp(event) {
  if (event.button !== undefined && event.button !== 0) return;
  // After the browser (or xterm, or CodeMirror) has settled the selection.
  setTimeout(() => {
    const found = read(event);
    shown.value = found ? { ...found, text: found.text.slice(0, MAX) } : null;
  }, 10);
}

function onDown(event) {
  if (!(event.target instanceof Element) || !event.target.closest(".ask-float")) shown.value = null;
}

function hide() {
  shown.value = null;
}

function onKey(event) {
  if (event.key === "Escape") hide();
}

function askAbout() {
  const { text, source, path } = shown.value;
  shown.value = null;
  openHelper({ selection: { text, source, path } });
}

onMounted(() => {
  document.addEventListener("mouseup", onUp, true);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
});
onBeforeUnmount(() => {
  document.removeEventListener("mouseup", onUp, true);
  document.removeEventListener("mousedown", onDown, true);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", hide, true);
  window.removeEventListener("resize", hide);
});
</script>

<template>
  <button
    v-if="shown && !(helper.status.checked && !helper.status.enabled)"
    class="ask-float"
    type="button"
    :style="{ left: `${shown.x}px`, top: `${shown.y}px` }"
    title="Ask Temporal about this"
    @mousedown.prevent
    @click="askAbout"
  >
    <span aria-hidden="true">✦</span> Ask
  </button>
</template>
