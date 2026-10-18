<script setup>
// Ask Temporal: a panel at the right edge for questions about Temporal, answered from
// Temporal's docs (through Kapa) with links to them, knowing which exercise you're on and,
// if you let it, the code you have open. It stays open while you work, so you can select
// something in the instructions, the editor or a terminal and ask about that.
import { computed, nextTick, ref, watch } from "vue";

import {
  ask,
  closeHelper,
  connectDocs,
  currentExercise,
  disconnectDocs,
  helper,
  newChat,
  refreshHelper,
  retry,
  selectionPrompts,
  sharedFile,
  stop,
  suggestions,
} from "../helper.js";
import { store, toast } from "../store.js";
import AccessForm from "./AccessForm.vue";
import AskMessage from "./AskMessage.vue";

const draft = ref("");
const input = ref(null);
const scroller = ref(null);
const status = computed(() => helper.status);
const ready = computed(() => status.value.enabled && status.value.signedIn);
const exercise = computed(() => (store.route.page === "exercise" ? currentExercise() : null));
// Re-read when the editor's tab or text changes, so the chip names the file on show.
const file = computed(() => (store.editorPath, store.fileTexts, helper.open ? sharedFile() : null));
const placeholder = computed(() =>
  helper.selection ? "Ask about the selection, or pick one below" : helper.thread.length ? "Ask a follow-up…" : "Ask anything about Temporal…",
);

const MCP_URL = "https://temporal.mcp.kapa.ai";
const elsewhere = [
  { name: "Claude Code", code: `claude mcp add --transport http temporal-docs ${MCP_URL}` },
  { name: "Cursor (~/.cursor/mcp.json)", code: JSON.stringify({ mcpServers: { "temporal-docs": { url: MCP_URL } } }, null, 2) },
  { name: "VS Code (.vscode/mcp.json)", code: JSON.stringify({ servers: { "temporal-docs": { type: "http", url: MCP_URL } } }, null, 2) },
];

function send(text = draft.value) {
  const question = text.trim() || (helper.selection ? selectionPrompts(helper.selection.source)[0] : "");
  if (!question || helper.busy) return;
  draft.value = "";
  ask(question);
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
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}

// Follows a streaming answer, unless the learner scrolled up to read.
let pinned = true;
function onScroll() {
  const el = scroller.value;
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
function scrollToEnd(force = false) {
  const el = scroller.value;
  if (el && (force || pinned)) el.scrollTop = el.scrollHeight;
}
watch(
  () => {
    const last = helper.thread.at(-1);
    return [helper.thread.length, last?.content?.length, last?.searches?.length, last?.state];
  },
  () => nextTick(() => scrollToEnd()),
);

watch(
  () => helper.focusTick,
  () => nextTick(() => input.value?.focus()),
);
watch(
  () => helper.open,
  (open) => {
    if (!open) return;
    pinned = true;
    nextTick(() => {
      scrollToEnd(true);
      input.value?.focus();
    });
  },
  { immediate: true },
);

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy: select the text instead.");
  }
}

function onBodyClick(event) {
  const button = event.target.closest("button[data-copy]");
  if (button) copy(button.closest(".snippet")?.querySelector("pre")?.innerText ?? "");
}

// Dragging the panel's left edge sets its width.
function resize(event) {
  event.preventDefault();
  document.body.classList.add("is-resizing");
  const move = (e) => {
    const max = Math.min(900, window.innerWidth / 2);
    helper.width = Math.round(Math.min(max, Math.max(360, window.innerWidth - e.clientX)));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("is-resizing");
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function signedIn() {
  refreshHelper().then(() => {
    if (helper.thread.at(-1)?.error?.code === "access") retry();
    else helper.focusTick++;
  });
}

const selectionLabel = computed(() => {
  const s = helper.selection;
  if (!s) return "";
  if (s.source === "editor") return `Selected in ${s.path?.split("/").pop() ?? "the editor"}`;
  if (s.source === "terminal") return "Selected in the terminal";
  return "Selected in the instructions";
});
</script>

<template>
  <aside v-if="helper.open" class="ask-panel" :style="{ '--ask-width': `${helper.width}px` }" aria-label="Ask Temporal">
    <div class="ask-resizer" role="separator" aria-orientation="vertical" aria-label="Resize Ask Temporal" @pointerdown="resize" />
    <header class="ask-header">
      <div class="ask-title">
        <span class="ask-mark" aria-hidden="true">✦</span>
        <div>
          <h2>Ask Temporal</h2>
          <p>Answers from Temporal's docs, with links</p>
        </div>
      </div>
      <div class="ask-header-actions">
        <button v-if="helper.thread.length" class="icon-btn" type="button" title="New conversation" aria-label="New conversation" @click="newChat">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button class="icon-btn" type="button" title="Close (Esc)" aria-label="Close Ask Temporal" @click="closeHelper">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </header>

    <div ref="scroller" class="ask-body" @scroll.passive="onScroll" @click="onBodyClick">
      <div v-if="!status.checked" class="ask-loading"><span class="ask-spinner" aria-hidden="true" />Checking…</div>

      <!-- Off here: no runner, or no model. The docs still work in a coding agent. -->
      <section v-else-if="!status.enabled" class="ask-card">
        <h3>The helper isn't on here</h3>
        <p>{{ status.reason || "This site has no helper behind it." }} The same Temporal docs search works in your coding agent:</p>
        <div v-for="tool in elsewhere" :key="tool.name" class="ask-elsewhere-item">
          <span>{{ tool.name }}</span>
          <div class="snippet"><div class="snippet-actions"><button class="snippet-btn" type="button" data-copy>Copy</button></div><pre class="hljs"><code>{{ tool.code }}</code></pre></div>
        </div>
      </section>

      <section v-else-if="!status.signedIn" class="ask-card">
        <h3>{{ store.runtime.codeRequired ? "Enter the workshop's code" : "Unlock the helper" }}</h3>
        <p v-if="store.runtime.codeRequired">The helper is for this workshop's learners. Use the access code your instructor gave you.</p>
        <AccessForm label="Unlock" :start="false" @done="signedIn" />
      </section>

      <template v-else>
        <div v-if="!helper.thread.length" class="ask-empty">
          <div class="ask-hello">
            <span class="ask-hello-mark" aria-hidden="true">✦</span>
            <h3>What do you want to know about Temporal?</h3>
            <p>
              I search Temporal's docs and answer with links to them.
              <template v-if="exercise">I know you're on <strong>{{ exercise.optional ? "the capstone" : `exercise ${exercise.number}` }}</strong><template v-if="file && helper.includeCode"> and can see <strong>{{ file.path.split("/").pop() }}</strong></template>.</template>
            </p>
          </div>

          <section v-if="status.docs !== 'ready'" class="ask-card ask-connect">
            <h3>One quick step first</h3>
            <p>The docs search is <a href="https://www.kapa.ai" target="_blank" rel="noopener">Kapa</a>'s, and it asks each person to confirm they're human once, with GitHub or Google. It's only a sign-in check: Kapa doesn't get your name or email, and it can't access your Gmail, your Google account's data or your GitHub repositories.</p>
            <button class="button button-primary" type="button" :disabled="helper.connecting" @click="connectDocs">
              {{ helper.connecting ? "Waiting for the sign-in window…" : "Verify with GitHub or Google" }}
            </button>
          </section>

          <div class="ask-suggestions" role="list" aria-label="Suggested questions">
            <button v-for="q in suggestions()" :key="q" class="ask-suggestion" type="button" role="listitem" :disabled="helper.busy" @click="send(q)">
              {{ q }}<span aria-hidden="true">→</span>
            </button>
          </div>

          <p class="ask-tip"><span aria-hidden="true">💡</span> Select text in the instructions, the editor or a terminal (an error, say) and click <strong>✦ Ask</strong> to ask about it.</p>

          <details class="ask-elsewhere">
            <summary>Use the same docs in your coding agent</summary>
            <div v-for="tool in elsewhere" :key="tool.name" class="ask-elsewhere-item">
              <span>{{ tool.name }}</span>
              <div class="snippet"><div class="snippet-actions"><button class="snippet-btn" type="button" data-copy>Copy</button></div><pre class="hljs"><code>{{ tool.code }}</code></pre></div>
            </div>
          </details>
        </div>

        <AskMessage v-for="message in helper.thread" :key="message.id" :message="message" :thread="helper.thread" />
      </template>
    </div>

    <footer v-if="ready" class="ask-composer">
      <div v-if="helper.selection" class="ask-selection">
        <div class="ask-selection-head">
          <span>{{ selectionLabel }}</span>
          <button class="icon-btn" type="button" title="Leave the selection out" aria-label="Leave the selection out" @click="helper.selection = null">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <pre>{{ helper.selection.text }}</pre>
        <div class="ask-quick">
          <button v-for="q in selectionPrompts(helper.selection.source)" :key="q" class="ask-chip" type="button" :disabled="helper.busy" @click="send(q)">{{ q }}</button>
        </div>
      </div>

      <div v-if="exercise || file" class="ask-context" aria-label="Sent with your question">
        <span v-if="exercise" class="ask-chip is-static" :title="`The helper has ${exercise.optional ? 'the capstone' : `exercise ${exercise.number}`}'s instructions`">
          {{ exercise.optional ? "★ Capstone" : `Exercise ${exercise.number}` }}
        </span>
        <button
          v-if="file"
          class="ask-chip"
          :class="{ 'is-off': !helper.includeCode }"
          type="button"
          :aria-pressed="helper.includeCode"
          :title="helper.includeCode ? `${file.path} goes with your question. Click to leave it out.` : `Click to send ${file.path} with your question`"
          @click="helper.includeCode = !helper.includeCode"
        >
          <span aria-hidden="true">{{ helper.includeCode ? "✓" : "+" }}</span> {{ file.path.split("/").pop() }}
        </button>
      </div>

      <form class="ask-input" @submit.prevent="send()">
        <textarea
          ref="input"
          v-model="draft"
          rows="1"
          :placeholder="placeholder"
          aria-label="Your question"
          @input="autosize"
          @keydown="onKeydown"
        />
        <button v-if="helper.busy" class="ask-send is-stop" type="button" title="Stop" aria-label="Stop" @click="stop">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
        </button>
        <button v-else class="ask-send" type="submit" :disabled="!draft.trim() && !helper.selection" title="Ask (Enter)" aria-label="Ask">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
      <p class="ask-fineprint">
        AI answers can be wrong: check the linked docs.
        <template v-if="status.docs === 'ready' && !status.sharedDocsKey"> · <button class="link-button" type="button" @click="disconnectDocs">Disconnect docs</button></template>
      </p>
    </footer>
  </aside>
</template>
