<script setup>
// Essentials' map (a branch with `map: sketch`): a page of the coordinator's sketchbook. Its steps
// are stops on a pencilled route, read left to right in three lines like writing, the boss at the
// end; the route is inked green as far as the learner has come. Each stop is a stamp with its
// module's emoji (a challenge a sticky note with ❓, the boss a crown), its title in hand and a
// scribbled note. Done stops get a tick; the next is circled in marker, "you are here". A click
// (or Enter) selects a stop, as on the other maps, and puts its way in under it, on the page:
// Start (Do it again, once done; for a locked stop, what comes first), so the eye needn't go to
// the panel beside the map. A second click (or Enter) on the selected stop takes it.
//
// The paper is paper in either theme: cream, ruled, with a margin and binder holes.
import "@fontsource/caveat/latin-500.css";
import "@fontsource/caveat/latin-700.css";
import { computed } from "vue";

import { STATE_LABEL, firstStepTo, isPlayable, moduleHref, modulesById, stateOf, trunk } from "../progress.js";
import { navigate } from "../store.js";

const props = defineProps({ selected: { type: String, default: null } });
const emit = defineEmits(["select"]);

const PER_ROW = 4;
const W = 960;
const X0 = 95;
const X1 = 830;
const ROW0 = 70;
// Room under each line's notes for the selected stop's Start, above the route's way back.
const ROW_H = 225;
// A stamp's lean, so the page looks drawn by hand (the same each time).
const LEAN = [-4, 3, -2, 5, -3, 2, 4, -5];

function wrap(text, chars) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > chars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line];
}

const steps = computed(() => {
  const mods = trunk.modules.map((id) => modulesById.get(id)).filter(isPlayable);
  const boss = trunk.boss ? modulesById.get(trunk.boss) : null;
  return boss ? [...mods, boss] : mods;
});

const stops = computed(() =>
  steps.value.map((m, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const x = X0 + ((X1 - X0) * col) / (PER_ROW - 1);
    const y = ROW0 + row * ROW_H + (col % 2 ? 16 : 0);
    const state = stateOf(m);
    const kind = m.kind;
    const emoji = kind === "boss" ? "🌙" : kind === "challenge" ? "❓" : (m.emoji ?? "•");
    const note = kind === "boss" ? "the boss" : kind === "challenge" ? "quick question" : (m.note ?? "");
    return { m, x, y, row, col, state, kind, emoji, note, lines: wrap(m.title, 20), lean: LEAN[i % LEAN.length], soon: !isPlayable(m) };
  }),
);

// The route through every stop: a gentle wobble along a line, then down the right edge, back
// along the gap under the line, and in to the next line's first stop from the left.
const segments = computed(() => {
  const list = stops.value;
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    let d;
    if (b.row === a.row) {
      const bend = i % 2 ? 14 : -14;
      d = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + bend} ${b.x} ${b.y}`;
    } else {
      const gap = a.y + ROW_H * 0.62;
      // Out past the labels at the line's end, down, back along the gap, and in from the left.
      d = `M ${a.x + 27} ${a.y} C ${a.x + 125} ${a.y - 4}, ${a.x + 125} ${gap}, ${a.x + 30} ${gap} L ${b.x - 10} ${gap} C ${b.x - 95} ${gap}, ${b.x - 95} ${b.y}, ${b.x - 27} ${b.y}`;
    }
    out.push({ d, done: a.state === "done" && (b.state === "done" || b.state === "next") });
  }
  return out;
});

// The selected stop's way in, under its note: where it goes (the panel's Start does the same),
// what it says, and where it sits. None for a stop that's coming soon.
const go = computed(() => {
  const s = stops.value.find((stop) => stop.m.id === props.selected);
  if (!s || s.soon) return null;
  const first = s.state === "locked" ? firstStepTo(s.m) : null;
  const text = s.state === "done" ? "Do it again ↻" : first ? "Start what's first ▸" : "Start ▸";
  const aria = s.state === "done" ? `Do ${s.m.title} again` : first ? `Start with ${first.title}, before ${s.m.title}` : `Start ${s.m.title}`;
  const width = Math.round(text.length * 8.6 + 30);
  return { id: s.m.id, href: moduleHref((first ?? s.m).id), text, aria, title: first ? `First: ${first.title}` : null, x: s.x, y: s.y + 78 + s.lines.length * 22, width };
});

// A click on a stop selects it; on the stop already selected, it takes its way in.
function pick(s) {
  if (props.selected === s.m.id && go.value) navigate(go.value.href);
  else emit("select", s.m.id);
}

const label = (s) => `${s.kind === "challenge" ? "Challenge: " : s.kind === "boss" ? "Boss: " : ""}${s.m.title}. ${s.soon ? "Coming soon" : STATE_LABEL[s.state]}`;
const crown = (x, y) => `M ${x - 34} ${y + 22} L ${x - 38} ${y - 18} L ${x - 16} ${y - 2} L ${x} ${y - 30} L ${x + 16} ${y - 2} L ${x + 38} ${y - 18} L ${x + 34} ${y + 22} Z`;
const modules = computed(() => steps.value.filter((m) => m.kind === "module").length);
const questions = computed(() => steps.value.filter((m) => m.kind === "challenge").length);
// To the last line's notes, and the Start under them.
const height = computed(() => ROW0 + (Math.ceil(stops.value.length / PER_ROW) - 1) * ROW_H + 150);
</script>

<template>
  <section class="sketch-map" aria-label="The sketchbook: Essentials, stop by stop">
    <h2 class="sketch-title">The trip that never loses its place</h2>
    <p class="sketch-sub">{{ modules }} stops, {{ questions }} quick questions, and the night shift at the end</p>
    <svg class="sketch-svg" :viewBox="`0 0 ${W} ${height}`" role="group" aria-label="Stops, left to right, line by line">
      <path v-for="(seg, i) in segments" :key="`r-${i}`" :class="['sketch-route', { 'is-done': seg.done }]" :d="seg.d" />

      <g
        v-for="s in stops"
        :key="s.m.id"
        :class="['sketch-stop', `is-${s.state}`, `kind-${s.kind}`, { 'is-selected': selected === s.m.id, 'is-soon': s.soon }]"
        role="button"
        tabindex="0"
        :data-module="s.m.id"
        :aria-label="selected === s.m.id && go ? `${label(s)}. Press again to open` : label(s)"
        :aria-pressed="selected === s.m.id"
        @click="pick(s)"
        @keydown.enter.prevent="pick(s)"
        @keydown.space.prevent="pick(s)"
      >
        <g :transform="`rotate(${s.lean} ${s.x} ${s.y})`">
          <ellipse v-if="selected === s.m.id" class="sketch-pick" :cx="s.x" :cy="s.y" rx="44" ry="40" />
          <rect v-if="s.kind === 'challenge'" class="sketch-stamp" :x="s.x - 26" :y="s.y - 26" width="52" height="52" rx="3" />
          <path v-else-if="s.kind === 'boss'" class="sketch-stamp" :d="crown(s.x, s.y)" />
          <circle v-else class="sketch-stamp" :cx="s.x" :cy="s.y" r="27" />
          <text class="sketch-emoji" :x="s.x" :y="s.y + (s.kind === 'boss' ? 11 : 9)" text-anchor="middle">{{ s.emoji }}</text>
          <text v-if="s.state === 'done'" class="sketch-tick" :x="s.x + 17" :y="s.y - 15">✓</text>
          <text v-for="(line, k) in s.lines" :key="k" class="sketch-name" :x="s.x" :y="s.y + 52 + k * 22" text-anchor="middle">{{ line }}</text>
          <text class="sketch-note" :x="s.x" :y="s.y + 54 + s.lines.length * 22" text-anchor="middle">{{ s.note }}</text>
        </g>
        <template v-if="s.state === 'next'">
          <path class="sketch-here" :d="`M ${s.x - 50} ${s.y - 6} C ${s.x - 52} ${s.y - 50}, ${s.x + 54} ${s.y - 48}, ${s.x + 52} ${s.y + 2} C ${s.x + 50} ${s.y + 44}, ${s.x - 48} ${s.y + 48}, ${s.x - 44} ${s.y - 14}`" />
          <text class="sketch-here-note" :x="s.x + 18" :y="s.y - 46">you are here ✍️</text>
        </template>
      </g>

      <!-- Over the stops and the route (a label on the page), not inside its stop's button. -->
      <a v-if="go" :key="go.id" class="sketch-go" :href="go.href" :aria-label="go.aria" :data-go="go.id">
        <title v-if="go.title">{{ go.title }}</title>
        <g :transform="`rotate(-2 ${go.x} ${go.y})`">
          <rect class="sketch-go-box" :x="go.x - go.width / 2" :y="go.y - 18" :width="go.width" height="26" rx="9" />
          <text class="sketch-go-text" :x="go.x" :y="go.y + 1" text-anchor="middle">{{ go.text }}</text>
        </g>
      </a>
    </svg>
  </section>
</template>
