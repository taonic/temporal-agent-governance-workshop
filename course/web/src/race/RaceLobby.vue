<script setup>
// The stalls: what a racer sees before the gun, over the course. Their horse, their stall, their
// sandbox warming up (so it's ready when the gates open), how many riders are in, then 3, 2, 1.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { store } from "../store.js";
import Horse from "./Horse.vue";
import { live, serverNow } from "./live.js";
import { field, me, phase, raceState } from "./racing.js";

const now = ref(serverNow());
let timer = 0;
onMounted(() => (timer = setInterval(() => (now.value = serverNow()), 200)));
onBeforeUnmount(() => clearInterval(timer));

const count = computed(() => (phase.value === "countdown" ? Math.max(1, Math.ceil((raceState.value.race.startedAt - now.value) / 1000)) : null));
const SANDBOX = {
  ready: ["✓", "Your sandbox is ready."],
  error: ["!", "Your sandbox hit a problem: it'll be retried from the course."],
  full: ["!", "No sandbox free right now: tell the host."],
  allowance: ["!", "Out of sandbox time: tell the host."],
};
const sandbox = computed(() => SANDBOX[store.sandbox.state] ?? ["…", "Warming up your sandbox, so it's ready at the gun…"]);
</script>

<template>
  <div class="race-lobby" role="dialog" aria-modal="true" aria-label="The starting stalls">
    <div class="race-lobby-card">
      <p class="race-lobby-kicker">🏇 {{ store.race.raceName }}</p>
      <h2 v-if="count" class="race-lobby-count" :key="count">{{ count }}</h2>
      <h2 v-else>{{ live.loaded ? "You're in the stalls" : "Finding your stall…" }}</h2>
      <div class="race-lobby-horse">
        <Horse :creature="store.race.creature" :silks="store.race.silks" :pattern="store.race.pattern" :coat="me?.coat" :number="me ? me.lane + 1 : ''" :gait="count ? 'trot' : 'idle'" :label="store.race.horse" />
      </div>
      <p class="race-lobby-names"><strong>{{ store.race.horse }}</strong>, ridden by {{ store.race.name }}<template v-if="me">, in stall {{ me.lane + 1 }}</template></p>
      <p class="race-lobby-wait">{{ count ? "Get ready…" : `Waiting for the host to start the race. ${field} ${field === 1 ? "rider" : "riders"} in so far.` }}</p>
      <p class="race-lobby-sandbox" :class="`is-${store.sandbox.state}`"><span aria-hidden="true">{{ sandbox[0] }}</span> {{ sandbox[1] }}</p>
      <p class="race-lobby-tip">This race is won by understanding, not speed: each question right the first time scores the most, and a wrong guess costs XP. At the same XP, fewer slips win. Take your time and read. Your pit-pass, to switch device: <code>{{ store.race.pitPass }}</code></p>
    </div>
  </div>
</template>

<style>
.race-lobby {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 16px;
  background: radial-gradient(ellipse at 50% -10%, #1d6b4f, #0b3d2e 60%);
  overflow: auto;
}
.race-lobby-card {
  width: min(560px, 100%);
  padding: 28px 24px;
  border-radius: 20px;
  background: var(--paper);
  color: var(--text);
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.race-lobby-kicker {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #0f8b68;
}
.race-lobby-card h2 {
  margin: 6px 0 10px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 30px;
}
.race-lobby-card h2.race-lobby-count {
  font-family: inherit;
  font-size: 96px;
  line-height: 1;
  color: #0f8b68;
  animation: race-lobby-count 1s ease-out;
}
.race-lobby-horse {
  margin: 0 auto;
  width: min(300px, 80%);
  padding-top: 8px;
  border-radius: 14px;
  background: linear-gradient(180deg, #bfe3c7 0 60%, #3f8f3a 60%);
}
.race-lobby-names {
  margin: 12px 0 4px;
  font-size: 17px;
}
.race-lobby-wait {
  margin: 0 0 14px;
  color: var(--muted);
}
.race-lobby-sandbox {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 14px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--amber-soft);
  font-size: 14px;
  font-weight: 600;
}
.race-lobby-sandbox.is-ready {
  background: var(--success-soft);
  color: var(--success);
}
.race-lobby-tip {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.race-lobby-tip code {
  font-weight: 800;
  color: var(--text);
}
@keyframes race-lobby-count {
  from { transform: scale(1.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
</style>
