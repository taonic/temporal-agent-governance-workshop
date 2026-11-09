<script setup>
// A node of the skill tree, as one glyph wherever it's drawn: the map, the focus trail, the list,
// the legend and the detail panel. A module and a challenge are circles (a challenge marked with a
// bolt), a boss a hexagon; its fill and mark say where the learner stands:
//   Next       purple fill, a white dot: you are here (the play mark is the Start button's alone)
//   Available  a bright outline in its branch's colour, its id (or a challenge's bolt, a boss's crown)
//   Completed  green fill, a check
//   Locked     subdued, a lock
// Coming soon is not a state: a dashed outline over whichever it is.
//
// Inside the map's SVG, pass x and y (its centre) and it nests there; anywhere else it's an inline icon.
const props = defineProps({
  kind: { type: String, default: "module" },
  state: { type: String, required: true },
  label: { type: String, default: "" },
  color: { type: String, default: "" },
  soon: { type: Boolean, default: false },
  size: { type: Number, default: 36 },
  x: { type: Number, default: null },
  y: { type: Number, default: null },
  halo: { type: Boolean, default: false },
});

const nested = props.x !== null;

function hexagon(r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}
const CROWN = "-9,6 -10,-5 -4.5,0 0,-8 4.5,0 10,-5 9,6";
const BOLT = "M 2 -9 L -5.5 1.5 H 0 L -2 9 L 5.5 -1.5 H 0 Z";
</script>

<template>
  <svg
    :class="['node-glyph', `is-${state}`, `kind-${kind}`, color && `branch-${color}`, { 'is-soon': soon }]"
    viewBox="-25 -25 50 50"
    :width="size"
    :height="size"
    :x="nested ? x - size / 2 : null"
    :y="nested ? y - size / 2 : null"
    overflow="visible"
    aria-hidden="true"
  >
    <circle v-if="halo && state === 'next'" class="glyph-halo" r="24" />
    <polygon v-if="kind === 'boss'" class="glyph-shape" :points="hexagon(22)" />
    <circle v-else class="glyph-shape" r="19" />

    <path v-if="state === 'done'" class="glyph-mark-stroke" d="M -7 0.5 L -2.2 5.2 L 7.5 -5" />
    <circle v-else-if="state === 'next'" class="glyph-mark" r="6" />
    <g v-else-if="state === 'locked'">
      <path class="glyph-mark-stroke is-thin" d="M -4 -1 V -4.5 a 4 4 0 0 1 8 0 V -1" />
      <rect class="glyph-mark" x="-6.5" y="-1.5" width="13" height="10" rx="2" />
    </g>
    <polygon v-else-if="kind === 'boss'" class="glyph-mark" :points="CROWN" />
    <path v-else-if="kind === 'challenge'" class="glyph-mark" :d="BOLT" />
    <text v-else class="glyph-id" y="4" text-anchor="middle" :style="{ fontSize: label.length > 2 ? '10px' : '12px' }">{{ label }}</text>
  </svg>
</template>
