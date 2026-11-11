<script setup>
// A racer's horse and jockey, side on, facing right: the horse's coat, the jockey (a creature, as
// its head) in the racer's silks, and the saddlecloth's number. `gait` moves it: idle (breathing),
// trot (into the stalls), gallop, stumble (a wrong pick), graze (no progress for a while).
import { computed } from "vue";

import { COATS, creatureOf, silksOf } from "./avatars.js";

const props = defineProps({
  creature: { type: String, default: "gecko" },
  silks: { type: String, default: "scarlet" },
  pattern: { type: String, default: "hoops" },
  coat: { type: Object, default: () => COATS[0] },
  number: { type: [Number, String], default: "" },
  gait: { type: String, default: "idle" },
  label: { type: String, default: "" },
});

let uid = 0;
const id = `silks-${Date.now().toString(36)}-${++uid}-${Math.random().toString(36).slice(2, 6)}`;
const colour = computed(() => silksOf(props.silks));
const head = computed(() => creatureOf(props.creature));
const fill = computed(() => (props.pattern === "plain" ? colour.value.color : `url(#${id})`));
// The far legs, a shade darker: the near ones are in front.
const farLeg = computed(() => `color-mix(in srgb, ${props.coat.body} 72%, black)`);
const STAR = "0,-2.6 0.75,-0.8 2.5,-0.8 1.1,0.3 1.6,2.1 0,1 -1.6,2.1 -1.1,0.3 -2.5,-0.8 -0.75,-0.8";
const spikes = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const p = (r, d) => `${(Math.cos(a + d) * r).toFixed(2)},${(Math.sin(a + d) * r).toFixed(2)}`;
  return `${p(7.6, -0.22)} ${p(11, 0)} ${p(7.6, 0.22)}`;
});
</script>

<template>
  <svg class="horse" :class="`is-${gait}`" viewBox="0 0 140 104" :role="label ? 'img' : undefined" :aria-label="label || undefined" :aria-hidden="label ? undefined : 'true'">
    <defs>
      <pattern :id="id" patternUnits="userSpaceOnUse" width="7" height="7">
        <rect width="7" height="7" :fill="colour.color" />
        <rect v-if="pattern === 'hoops'" y="3.5" width="7" height="3.5" :fill="colour.ink" opacity=".9" />
        <rect v-else-if="pattern === 'stripes'" x="3.5" width="3.5" height="7" :fill="colour.ink" opacity=".9" />
        <polygon v-else-if="pattern === 'stars'" :points="STAR" transform="translate(3.5 3.5)" :fill="colour.ink" />
        <polygon v-else-if="pattern === 'diamonds'" points="3.5,0.6 6.4,3.5 3.5,6.4 0.6,3.5" :fill="colour.ink" opacity=".9" />
      </pattern>
    </defs>

    <ellipse class="horse-shadow" cx="66" cy="101" rx="46" ry="3" />
    <g class="horse-rig">
      <!-- The far legs, behind the body. -->
      <g class="leg leg-ff" transform="translate(82 68)"><g class="leg-swing"><rect x="-3" y="0" width="6" height="30" rx="3" :fill="farLeg" /><rect x="-3.5" y="27" width="7" height="4" rx="1.5" fill="#1d1d1f" /></g></g>
      <g class="leg leg-bf" transform="translate(34 68)"><g class="leg-swing"><rect x="-3" y="0" width="6" height="30" rx="3" :fill="farLeg" /><rect x="-3.5" y="27" width="7" height="4" rx="1.5" fill="#1d1d1f" /></g></g>

      <g class="horse-body">
        <path class="horse-tail" d="M22 54 C9 56 5 70 9 82 C14 73 18 64 25 59 Z" :fill="coat.mane" />
        <ellipse cx="36" cy="60" rx="15" ry="14" :fill="coat.body" />
        <ellipse cx="62" cy="62" rx="32" ry="15" :fill="coat.body" />
        <ellipse cx="86" cy="60" rx="12" ry="13" :fill="coat.body" />
        <g class="horse-neck">
          <path d="M80 58 C86 46 92 34 100 26 L112 33 C104 40 99 50 97 62 Z" :fill="coat.body" />
          <path d="M99 23 C107 18 118 23 127 34 C130 38 127 43 121 41 C114 39 108 38 102 36 Z" :fill="coat.body" />
          <path d="M102 23 L104 14 L109 22 Z" :fill="coat.body" />
          <path d="M99 23 C93 32 87 43 80 56 L85 57 C91 45 97 34 104 26 Z" :fill="coat.mane" />
          <circle cx="111" cy="28" r="1.7" fill="#111" />
          <circle cx="124" cy="38" r="1" fill="#111" opacity=".6" />
          <text class="horse-grass" x="128" y="96" font-size="15" text-anchor="middle">🌿</text>
        </g>
        <!-- The saddlecloth, with the stall's number. -->
        <rect x="47" y="50" width="25" height="15" rx="2.5" :fill="colour.color" stroke="rgba(0,0,0,.25)" stroke-width=".8" />
        <text x="52.5" y="61.5" font-size="9.5" font-weight="800" text-anchor="middle" :fill="colour.ink" font-family="ui-sans-serif, system-ui, sans-serif">{{ number }}</text>
        <path d="M86 42 L121 38" stroke="#3b2a1a" stroke-width="1.1" fill="none" />
      </g>

      <g class="jockey">
        <path d="M58 50 L70 55 L69 65 L64 65 L65 57 L55 53 Z" fill="#f5f5f4" stroke="rgba(0,0,0,.2)" stroke-width=".6" />
        <rect x="63" y="62" width="8" height="5" rx="1.2" fill="#1f2937" />
        <path d="M52 52 C50 41 56 31 66 28 L73 32 C67 36 63 44 62 52 Z" :fill="fill" stroke="rgba(0,0,0,.25)" stroke-width=".8" />
        <path d="M68 32 L78 40 L86 42" :stroke="colour.color" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        <circle cx="86" cy="42" r="2.2" fill="#f5d0b0" />
        <g class="jockey-head">
          <g v-if="head.id === 'durian'" transform="translate(69 21)">
            <polygon v-for="(s, i) in spikes" :key="i" :points="s" fill="#8a9a1f" />
            <circle r="8" fill="#c3d14a" stroke="#7a8a1d" stroke-width="1" />
            <circle cx="-2.6" cy="-1" r="1.1" fill="#1d1d1f" />
            <circle cx="2.6" cy="-1" r="1.1" fill="#1d1d1f" />
            <path d="M-2.6 2.4 Q0 4.8 2.6 2.4" stroke="#1d1d1f" stroke-width="1" fill="none" stroke-linecap="round" />
          </g>
          <text v-else x="69" y="22" font-size="17" text-anchor="middle" dominant-baseline="central">{{ head.emoji }}</text>
          <path d="M60.5 13 Q69 2.5 77.5 13 Z" :fill="colour.color" stroke="rgba(0,0,0,.3)" stroke-width=".7" />
          <path d="M76 12.6 L83.5 14" :stroke="colour.color" stroke-width="2.2" stroke-linecap="round" />
        </g>
      </g>

      <!-- The near legs, in front. -->
      <g class="leg leg-fn" transform="translate(89 68)"><g class="leg-swing"><rect x="-3" y="0" width="6" height="30" rx="3" :fill="coat.body" /><rect x="-3.5" y="27" width="7" height="4" rx="1.5" fill="#1d1d1f" /></g></g>
      <g class="leg leg-bn" transform="translate(41 68)"><g class="leg-swing"><rect x="-3" y="0" width="6" height="30" rx="3" :fill="coat.body" /><rect x="-3.5" y="27" width="7" height="4" rx="1.5" fill="#1d1d1f" /></g></g>
    </g>
  </svg>
</template>

<style>
.horse {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.horse-shadow {
  fill: rgba(0, 0, 0, 0.22);
}

.horse .leg-swing {
  transform-box: fill-box;
  transform-origin: 50% 0%;
}

.horse .horse-neck {
  transform-box: view-box;
  transform-origin: 84px 58px;
  transition: transform 0.6s ease;
}

.horse .horse-tail {
  transform-box: view-box;
  transform-origin: 24px 56px;
  animation: horse-tail 2.6s ease-in-out infinite;
}

.horse .horse-grass {
  opacity: 0;
  transition: opacity 0.4s ease;
}

.horse .horse-rig,
.horse .jockey {
  transform-box: view-box;
}

.horse.is-idle .horse-rig {
  transform-origin: 66px 100px;
  animation: horse-breathe 2.8s ease-in-out infinite;
}

.horse.is-gallop .leg-swing {
  animation: horse-gallop 0.38s linear infinite;
}
.horse.is-gallop .leg-ff .leg-swing { animation-delay: -0.07s; }
.horse.is-gallop .leg-bn .leg-swing { animation-delay: -0.19s; }
.horse.is-gallop .leg-bf .leg-swing { animation-delay: -0.26s; }
.horse.is-gallop .horse-rig {
  animation: horse-bob 0.38s ease-in-out infinite;
}
.horse.is-gallop .horse-tail {
  animation: horse-tail-fly 0.38s ease-in-out infinite;
}

.horse.is-trot .leg-swing {
  animation: horse-trot 0.56s ease-in-out infinite;
}
.horse.is-trot .leg-ff .leg-swing,
.horse.is-trot .leg-bn .leg-swing { animation-delay: -0.28s; }
.horse.is-trot .horse-rig {
  animation: horse-bob 0.28s ease-in-out infinite;
}

.horse.is-stumble .horse-rig {
  transform-origin: 92px 100px;
  animation: horse-stumble 1.1s ease-in-out;
}
.horse.is-stumble .jockey {
  transform-origin: 60px 52px;
  animation: jockey-wobble 1.1s ease-in-out;
}

.horse.is-graze .horse-neck {
  transform: rotate(40deg);
}
.horse.is-graze .horse-grass {
  opacity: 1;
}
.horse.is-graze .horse-rig {
  transform-origin: 66px 100px;
  animation: horse-breathe 3.6s ease-in-out infinite;
}

@keyframes horse-gallop {
  0% { transform: rotate(-40deg); }
  50% { transform: rotate(32deg); }
  100% { transform: rotate(-40deg); }
}
@keyframes horse-trot {
  0%, 100% { transform: rotate(-18deg); }
  50% { transform: rotate(16deg); }
}
@keyframes horse-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3.5px); }
}
@keyframes horse-breathe {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.012); }
}
@keyframes horse-tail {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(7deg); }
}
@keyframes horse-tail-fly {
  0%, 100% { transform: rotate(-16deg); }
  50% { transform: rotate(-26deg); }
}
@keyframes horse-stumble {
  0% { transform: rotate(0); }
  25% { transform: rotate(14deg) translateY(5px); }
  55% { transform: rotate(-5deg); }
  80% { transform: rotate(3deg); }
  100% { transform: rotate(0); }
}
@keyframes jockey-wobble {
  0%, 100% { transform: rotate(0); }
  20% { transform: rotate(16deg) translateX(4px); }
  45% { transform: rotate(-14deg); }
  70% { transform: rotate(8deg); }
}

@media (prefers-reduced-motion: reduce) {
  .horse .leg-swing,
  .horse .horse-rig,
  .horse .horse-tail,
  .horse .jockey {
    animation: none !important;
  }
}
</style>
