<script setup>
// Two real terminals in the learner's sandbox, side by side: "worker", for the process the
// exercises stop and start, and "commands", for everything else. The buttons type into them, so
// what a button did is always on screen.
import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import SandboxStatus from "./SandboxStatus.vue";
import WorkerToggle from "./WorkerToggle.vue";
import { openPane, registerHook, uiProxyOrigin } from "../store.js";

const props = defineProps({
  exercise: { type: Object, required: true },
  live: { type: Boolean, default: false },
});

const NAMES = ["worker", "commands"];
// The one last clicked or typed into: its selection is the one Ask Temporal gets.
const active = ref("worker");
const hosts = { worker: ref(null), commands: ref(null) };
const status = reactive({ worker: "idle", commands: "idle" });
const terms = {};

const theme = {
  background: "#0d0d10",
  foreground: "#e7ebf2",
  cursor: "#818cf8",
  selectionBackground: "#3a3f6b",
  black: "#1d1d20", red: "#f87171", green: "#34d399", yellow: "#fbbf24",
  blue: "#818cf8", magenta: "#c084fc", cyan: "#67e8f9", white: "#e7ebf2",
  brightBlack: "#6b7382", brightRed: "#fca5a5", brightGreen: "#6ee7b7", brightYellow: "#fde68a",
  brightBlue: "#a5b4fc", brightMagenta: "#d8b4fe", brightCyan: "#a5f3fc", brightWhite: "#ffffff",
};

// Links the sandbox prints to its own Temporal UI open in the pane, not a new tab.
function openLink(event, uri) {
  const origin = uiProxyOrigin();
  if (origin && uri.startsWith(origin)) {
    event.preventDefault?.();
    openPane("temporal", uri.slice(origin.length) || "/");
    return;
  }
  window.open(uri, "_blank", "noopener");
}

function create(name) {
  const term = new Terminal({
    theme,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 12.5,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon(openLink));
  term.open(hosts[name].value);
  const state = { term, fit, ws: null, retry: 0, timer: 0, closed: false, queue: [] };
  term.onData((data) => send(name, data));
  term.onResize(({ cols, rows }) => {
    if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: "resize", cols, rows }));
  });
  terms[name] = state;
  return state;
}

function send(name, data) {
  const state = terms[name];
  if (!state) return;
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: "input", data }));
  else state.queue.push(data);
}

function connect(name) {
  const state = terms[name];
  if (!state || state.closed || !props.live) return;
  clearTimeout(state.timer);
  try {
    state.fit.fit();
  } catch {
    /* not visible yet */
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/api/terminal/${name}?cols=${state.term.cols}&rows=${state.term.rows}`);
  ws.binaryType = "arraybuffer";
  state.ws = ws;
  status[name] = "connecting";
  let replaying = true;
  ws.onopen = () => {
    state.retry = 0;
    state.term.reset();
  };
  ws.onmessage = (event) => {
    if (typeof event.data === "string") {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "status") {
        status[name] = message.state;
        if (message.state === "connected") {
          replaying = false;
          for (const data of state.queue.splice(0)) send(name, data);
        }
        if (message.state === "error") state.term.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
      }
      return;
    }
    state.term.write(new Uint8Array(event.data));
    if (!replaying) status[name] = "connected";
  };
  ws.onclose = () => {
    if (state.ws !== ws) return;
    state.ws = null;
    status[name] = "disconnected";
    if (state.closed || !props.live) return;
    state.retry = Math.min(state.retry + 1, 6);
    state.timer = setTimeout(() => connect(name), 500 * 2 ** state.retry);
  };
}

function disconnect(name) {
  const state = terms[name];
  if (!state) return;
  clearTimeout(state.timer);
  const ws = state.ws;
  state.ws = null;
  ws?.close();
  status[name] = "idle";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Commands typed in order. A worker command first interrupts whatever runs there.
async function type(name, commands, { interrupt }) {
  active.value = name;
  if (interrupt) {
    send(name, "\x03");
    await sleep(900);
  }
  for (const command of commands) send(name, `${command}\r`);
  terms[name]?.term.focus();
}

const runCheck = () => props.exercise.scripts.check && type("commands", [props.exercise.scripts.check], { interrupt: false });

function fit(name) {
  try {
    terms[name]?.fit.fit();
  } catch {
    /* hidden */
  }
}

let observer = null;
let unregister = null;
let unregisterSelection = null;
onMounted(() => {
  for (const name of NAMES) create(name);
  if (props.live) NAMES.forEach(connect);
  observer = new ResizeObserver(() => NAMES.forEach(fit));
  for (const name of NAMES) observer.observe(hosts[name].value);
  unregister = registerHook("terminal", (target, commands, options) => type(target, commands, options));
  unregisterSelection = registerHook("terminalSelection", () => terms[active.value]?.term.getSelection() ?? "");
});

watch(
  () => props.live,
  (live) => {
    for (const name of NAMES) {
      if (live) connect(name);
      else disconnect(name);
    }
  },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  unregister?.();
  unregisterSelection?.();
  for (const name of NAMES) {
    const state = terms[name];
    if (!state) continue;
    state.closed = true;
    disconnect(name);
    state.term.dispose();
  }
});

defineExpose({ runCheck });
</script>

<template>
  <div class="terminal-dock" data-tour="terminals">
    <div class="dock-bar">
      <div class="runner-actions" data-tour="terminal-actions">
        <WorkerToggle :exercise="exercise" :live="live" />
        <button v-if="exercise.scripts.check" class="button button-primary" type="button" :disabled="!live" :title="`Run the check: ${exercise.scripts.check}`" @click="runCheck">✓ Check</button>
      </div>
    </div>
    <div class="terminal-body">
      <section v-for="name in NAMES" :key="name" class="terminal-pane" :class="{ active: active === name }" :aria-label="`The ${name} terminal`">
        <header class="terminal-pane-head"><span class="term-dot" :class="status[name]" aria-hidden="true" />{{ name }}</header>
        <div :ref="(el) => (hosts[name].value = el)" class="terminal-host" @pointerdown="active = name" @focusin="active = name" />
      </section>
      <div v-if="!live" class="dock-status"><SandboxStatus /></div>
    </div>
  </div>
</template>
