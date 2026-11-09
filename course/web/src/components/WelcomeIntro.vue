<script setup>
// The title screen a visitor lands on (when: intro.js). Deep space; the Temporal mark draws itself
// and flashes, the skill tree's branches light up around it as a constellation, the title comes
// in letter by letter, and light keeps circling the mark's orbits (it keeps running: durable).
// Any key, a click anywhere, or Start warps through the stars to the map. Skip is there from the
// first frame. With reduced motion, it's all there at once and fades out.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { markIntroSeen, starfield } from "../intro.js";
import { level, title, xp } from "../progress.js";
import { course } from "../store.js";

// reveal: the overlay starts to fade, so the page behind can arrive under it. done: it's gone.
const emit = defineEmits(["reveal", "done"]);

const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const canvas = ref(null);
const startButton = ref(null);
const leaving = ref(false);
let field = null;
let leaveTimer = 0;
let revealTimer = 0;

// The mark: the Temporal logo itself (the favicon's, in its 192 × 192 box, centred here), shown
// through a mask traced along its two orbits. Its strokes follow those two ellipses, 25 × 74
// about its centre, so the trace reveals the interlaced shape and the comets ride its strokes.
const LOGO = "M123.34 68.6596C119.655 41.0484 110.327 18 96 18C81.6731 18 72.3454 41.0484 68.6596 68.6596C41.0484 72.3454 18 81.6731 18 96C18 110.327 41.0525 119.655 68.6596 123.34C72.3454 150.948 81.6731 174 96 174C110.327 174 119.655 150.948 123.34 123.34C150.952 119.655 174 110.327 174 96C174 81.6731 150.948 72.3454 123.34 68.6596ZM67.7583 115.298C41.3151 111.479 25.893 102.737 25.893 96C25.893 89.2629 41.3151 80.5212 67.7583 76.7021C67.1764 83.0674 66.8733 89.566 66.8733 96C66.8733 102.434 67.1764 108.937 67.7583 115.298ZM96 25.893C102.737 25.893 111.479 41.3151 115.298 67.7583C108.937 67.1764 102.434 66.8733 96 66.8733C89.566 66.8733 83.0633 67.1764 76.7021 67.7583C80.5212 41.3151 89.2629 25.893 96 25.893ZM124.242 115.298C122.94 115.488 117.602 116.114 116.252 116.248C116.118 117.602 115.488 122.936 115.302 124.238C111.483 150.681 102.741 166.103 96.0041 166.103C89.267 166.103 80.5253 150.681 76.7061 124.238C76.5202 122.936 75.8898 117.598 75.7564 116.248C75.1421 109.979 74.7703 103.246 74.7703 96C74.7703 88.7537 75.1421 82.0206 75.7564 75.7483C82.0247 75.134 88.7577 74.7622 96.0041 74.7622C103.25 74.7622 109.983 75.134 116.252 75.7483C117.606 75.8817 122.94 76.5121 124.242 76.698C150.685 80.5172 166.111 89.2629 166.111 95.996C166.111 102.729 150.685 111.479 124.242 115.298Z";
const MARK_SCALE = 1.5;
const ellipse = (rx, ry) => `M 0 ${-ry} A ${rx} ${ry} 0 1 1 0 ${ry} A ${rx} ${ry} 0 1 1 0 ${-ry}`;
const ORBITS = [ellipse(25, 74), ellipse(74, 25)];

// The branches, around the mark: Fundamentals at the top, the rest clockwise. A label sits on
// the far side of its node from the mark, clear of the beam.
const RING = { rx: 268, ry: 192 };
const stars = course.branches.map((branch, i, all) => {
  const angle = -Math.PI / 2 + (i / all.length) * Math.PI * 2;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const x = cos * RING.rx;
  const y = sin * RING.ry;
  const length = Math.hypot(x, y);
  // The beam runs from just outside the mark to just short of the node.
  const from = 128 / length;
  const to = (length - 34) / length;
  return {
    ...branch,
    x,
    y,
    beam: `M ${(x * from).toFixed(1)} ${(y * from).toFixed(1)} L ${(x * to).toFixed(1)} ${(y * to).toFixed(1)}`,
    delay: 1600 + i * 110,
  };
});
// The constellation's outline: each branch to the next.
const links = stars.map((a, i) => {
  const b = stars[(i + 1) % stars.length];
  return { id: `${a.id}-${b.id}`, d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`, delay: 2300 + i * 70 };
});

const returning = computed(() => xp.value > 0);
const letters = [..."Temporal Quest"];

function begin() {
  if (leaving.value) return;
  leaving.value = true;
  field?.warp();
  // In step with .intro.is-leaving: the fade starts at 0.55s and ends at 1s (at once, and 0.3s).
  revealTimer = setTimeout(() => emit("reveal"), reduced ? 0 : 550);
  leaveTimer = setTimeout(() => emit("done"), reduced ? 300 : 1000);
}

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return; // reload, devtools, …
  if (["Tab", "Shift", "Meta", "Control", "Alt", "CapsLock"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  begin();
}

onMounted(() => {
  markIntroSeen();
  field = starfield(canvas.value, { reduced });
  window.addEventListener("keydown", onKey, true);
  document.documentElement.classList.add("intro-open");
  startButton.value?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  field?.stop();
  clearTimeout(leaveTimer);
  clearTimeout(revealTimer);
  window.removeEventListener("keydown", onKey, true);
  document.documentElement.classList.remove("intro-open");
});
</script>

<template>
  <div
    :class="['intro', { 'is-leaving': leaving, 'is-reduced': reduced }]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="intro-title"
    @click="begin"
  >
    <div class="intro-nebula" aria-hidden="true" />
    <canvas ref="canvas" class="intro-stars" aria-hidden="true" />

    <button class="intro-skip" type="button" @click.stop="begin">Skip intro</button>

    <div class="intro-stage">
      <svg class="intro-emblem" viewBox="-340 -262 680 522" aria-hidden="true">
        <defs>
          <linearGradient id="intro-uv" x1="1" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#6c74ff" />
            <stop offset="1" stop-color="#c58bff" />
          </linearGradient>
          <filter id="intro-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <!-- The constellation: beams out from the mark, then the outline between branches. -->
        <g class="intro-links">
          <path v-for="link in links" :key="link.id" class="intro-link" :d="link.d" pathLength="1" :style="{ animationDelay: `${link.delay}ms` }" />
        </g>
        <g>
          <path v-for="star in stars" :key="star.id" :class="['intro-beam', `branch-${star.color}`]" :d="star.beam" pathLength="1" :style="{ animationDelay: `${star.delay}ms` }" />
        </g>

        <!-- The mark, traced, then a flash and a shockwave. -->
        <circle class="intro-shock" r="300" />
        <g class="intro-mark">
          <g :transform="`scale(${MARK_SCALE})`">
            <!-- Soft-edged, so the head of the trace doesn't cut the glow off in a hard circle. -->
            <filter id="intro-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
            <mask id="intro-trace" maskUnits="userSpaceOnUse" x="-120" y="-120" width="240" height="240">
              <g filter="url(#intro-soft)">
                <path v-for="(d, i) in ORBITS" :key="i" class="intro-trace" :d="d" pathLength="1" :style="{ animationDelay: `${250 + i * 280}ms` }" />
              </g>
            </mask>
            <g mask="url(#intro-trace)">
              <g filter="url(#intro-glow)" transform="translate(-96 -96)">
                <path class="intro-logo" :d="LOGO" />
                <path class="intro-flare" :d="LOGO" />
              </g>
            </g>
          </g>
        </g>
        <!-- Light running along the mark's strokes, for good. -->
        <g class="intro-comets" filter="url(#intro-glow)">
          <g :transform="`scale(${MARK_SCALE})`">
            <path class="intro-comet" :d="ORBITS[0]" pathLength="1" />
            <path class="intro-comet is-second" :d="ORBITS[1]" pathLength="1" />
          </g>
        </g>

        <g v-for="star in stars" :key="star.id" :class="['intro-node', `branch-${star.color}`]" :transform="`translate(${star.x.toFixed(1)} ${star.y.toFixed(1)})`">
          <g class="intro-node-body" :style="{ animationDelay: `${star.delay + 380}ms` }">
            <circle class="intro-node-ring" r="27" />
            <text class="intro-node-icon" y="9" text-anchor="middle">{{ star.icon }}</text>
          </g>
          <text class="intro-node-label" :y="star.y < 0 ? -40 : 50" text-anchor="middle" :style="{ animationDelay: `${star.delay + 520}ms` }">{{ star.name }}</text>
        </g>
      </svg>

      <div class="intro-copy">
        <p class="intro-eyebrow">Learn Temporal</p>
        <h1 id="intro-title" class="intro-title" :aria-label="letters.join('')">
          <span v-for="(ch, i) in letters" :key="i" aria-hidden="true" :class="{ 'is-space': ch === ' ' }" :style="{ '--i': i }">{{ ch }}</span>
        </h1>
        <p class="intro-tagline">Durable workflows. Reliable AI agents. One quest at a time.</p>
        <div class="intro-cta">
          <p v-if="returning" class="intro-player">
            <span class="intro-level"><small>Lv</small>{{ level }}</span>{{ title }} · {{ xp }} XP
          </p>
          <button ref="startButton" class="intro-start" type="button" @click.stop="begin">
            <span aria-hidden="true">▶</span>{{ returning ? "Continue your quest" : "Start your quest" }}
          </button>
          <p class="intro-hint" aria-hidden="true">or press any key</p>
        </div>
      </div>
    </div>
  </div>
</template>
