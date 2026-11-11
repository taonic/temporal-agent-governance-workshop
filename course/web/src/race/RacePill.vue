<script setup>
// A racer's place in the race, in the top bar: "🏇 4th · 10 XP behind Durable Dancer", and the
// clock. A link to the race screen.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { clock, ordinal, serverNow } from "./live.js";
import { ahead, behind, field, me, phase, raceState } from "./racing.js";

const now = ref(serverNow());
let timer = 0;
onMounted(() => (timer = setInterval(() => (now.value = serverNow()), 1000)));
onBeforeUnmount(() => clearInterval(timer));

const left = computed(() => (raceState.value?.race.clockEndsAt ? raceState.value.race.clockEndsAt - now.value : null));
const final = computed(() => phase.value === "racing" && left.value !== null && left.value <= 10 * 60_000);

const text = computed(() => {
  const m = me.value;
  if (!m) return "The Derby";
  const place = `${ordinal(m.rank)} of ${field.value}`;
  if (phase.value === "finished") return `🏁 Final: ${place}`;
  if (m.finishedAt) return `✅ Every stop done · ${place}`;
  if (!m.xp && phase.value === "racing") return `🏇 ${place} · at the gate: go!`;
  if (m.rank === 1) {
    const gap = behind.value ? m.xp - behind.value.xp : 0;
    return gap > 0 ? `🥇 1st · ${gap} XP clear` : "🥇 1st · neck and neck";
  }
  const gap = ahead.value.xp - m.xp;
  return gap > 0 ? `🏇 ${place} · ${gap} XP behind ${ahead.value.horse}` : `🏇 ${place} · level with ${ahead.value.horse}`;
});
// The same, for a narrow screen: "4th/15 · −20".
const short = computed(() => {
  const m = me.value;
  if (!m) return "🏇";
  const place = `${ordinal(m.rank)}/${field.value}`;
  if (phase.value === "finished") return `🏁 ${place}`;
  if (m.finishedAt) return `✅ ${place}`;
  const gap = ahead.value ? ahead.value.xp - m.xp : 0;
  return `🏇 ${place}${gap > 0 ? ` · −${gap}` : ""}`;
});
</script>

<template>
  <a v-if="raceState" class="race-pill" :class="{ 'is-final': final, 'is-first': me?.rank === 1 }" :href="`/race/${raceState.race.slug}`" target="_blank" rel="noopener" title="Watch the race">
    <span class="race-pill-text">{{ text }}</span>
    <span class="race-pill-short">{{ short }}</span>
    <span v-if="phase === 'racing'" class="race-pill-clock">⏱ {{ clock(left) }}</span>
  </a>
</template>

<style>
.race-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 360px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #0b3d2e;
  color: #fbf5e6;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
  border: 1px solid #e9b949;
}
.race-pill-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.race-pill-clock {
  flex: none;
  font-variant-numeric: tabular-nums;
  color: #e9b949;
}
.race-pill.is-first {
  background: linear-gradient(90deg, #0b3d2e, #1d6b4f);
}
.race-pill.is-final .race-pill-clock {
  color: #fecaca;
  animation: race-pill-pulse 1s ease-in-out infinite;
}
@keyframes race-pill-pulse {
  50% { opacity: 0.5; }
}
.race-pill-short {
  display: none;
}
@media (max-width: 900px) {
  .race-pill-text {
    display: none;
  }
  .race-pill-short {
    display: inline;
  }
}
</style>
