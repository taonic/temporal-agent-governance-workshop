<script setup>
// A racer's place in the race, in the top bar: "🏇 4th · 10 XP behind Durable Dancer", and the
// clock. A click opens the rules (how XP is scored, how ties go) with where they stand, and a link
// to the race screen.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import { store } from "../store.js";
import { clock, ordinal, serverNow } from "./live.js";
import { ahead, behind, field, me, phase, raceState } from "./racing.js";
import { QUESTION_XP, quizTries, triesText } from "./rules.js";

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
// The rules, from the race's own stops: what each kind pays, try by try.
const open = ref(false);
const closeButton = ref(null);
const stops = computed(() => raceState.value?.course.stops ?? []);
const count = (kind) => stops.value.filter((s) => s.kind === kind).length;
const rules = computed(() => ({
  modules: count("module"),
  challenges: count("challenge"),
  questions: count("module") + count("challenge"),
  tries: triesText(quizTries(QUESTION_XP)),
  boss: stops.value.find((s) => s.kind === "boss") ?? null,
  max: raceState.value?.course.maxXp ?? 0,
}));
const slips = (n) => (n ? `${n} ${n === 1 ? "slip" : "slips"}` : "no slips");
async function show() {
  open.value = true;
  await nextTick();
  closeButton.value?.focus();
}

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
  <button v-if="raceState" class="race-pill" :class="{ 'is-final': final, 'is-first': me?.rank === 1 }" type="button" title="The race's rules, and where you stand" :aria-expanded="open" @click="show">
    <span class="race-pill-text">{{ text }}</span>
    <span class="race-pill-short">{{ short }}</span>
    <span v-if="phase === 'racing'" class="race-pill-clock">⏱ {{ clock(left) }}</span>
  </button>

  <Teleport to="body">
    <div v-if="open && raceState" class="race-rules-backdrop" @click.self="open = false" @keydown.escape="open = false">
      <section class="race-rules" role="dialog" aria-modal="true" aria-labelledby="race-rules-title">
        <header class="race-rules-head">
          <p class="race-rules-kicker">🏇 {{ raceState.race.name }}</p>
          <h2 id="race-rules-title">How the race is won</h2>
          <p class="race-rules-lead">By understanding, not speed. Take your time: read, try it, then answer.</p>
        </header>

        <div v-if="me" class="race-rules-you">
          <span><strong>{{ ordinal(me.rank) }}</strong> of {{ field }}</span>
          <span><strong>{{ me.xp }}</strong> / {{ rules.max }} XP</span>
          <span>{{ slips(me.stumbles) }}</span>
          <span v-if="phase === 'racing'">⏱ {{ clock(left) }} left</span>
          <span v-else-if="phase === 'finished'">🏁 Finished</span>
        </div>

        <h3>Scoring</h3>
        <ul class="race-rules-list">
          <li><span aria-hidden="true">❓</span> <strong>{{ rules.questions }} questions</strong>, all worth the same: one at the end of each of the {{ rules.modules }} stops, and the {{ rules.challenges }} quick questions. Each pays <strong>{{ rules.tries }} XP</strong> for a right answer on the first, second or a later try.</li>
          <li v-if="rules.boss"><span aria-hidden="true">🌙</span> <strong>{{ rules.boss.title }}</strong>, the boss: <strong>{{ rules.boss.xp }} XP</strong> for beating it.</li>
          <li><span aria-hidden="true">💯</span> The finish line is a perfect <strong>{{ rules.max }} XP</strong>: every answer right the first time.</li>
        </ul>

        <h3>Places</h3>
        <ul class="race-rules-list">
          <li><span aria-hidden="true">🥇</span> Most XP wins.</li>
          <li><span aria-hidden="true">🎯</span> At the same XP, <strong>fewer slips</strong> win. A slip is a wrong answer, or losing to the boss.</li>
          <li><span aria-hidden="true">⏱</span> Only then does time count: whoever reached that XP first.</li>
        </ul>

        <h3>Good to know</h3>
        <ul class="race-rules-list">
          <li><span aria-hidden="true">🕰</span> Only what you do between the start and the end of the clock counts.</li>
          <li><span aria-hidden="true">🌿</span> Reading or asking Temporal never costs you. Your horse only grazes if you've left the course for 15 minutes.</li>
          <li><span aria-hidden="true">🎟</span> Switching device? Your pit-pass is <code>{{ store.race?.pitPass }}</code>: enter it at <code>/join</code>.</li>
        </ul>

        <footer class="race-rules-actions">
          <a class="button button-secondary" :href="`/race/${raceState.race.slug}`" target="_blank" rel="noopener">Watch the race ↗</a>
          <button ref="closeButton" class="button button-primary" type="button" @click="open = false">Back to it</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style>
.race-pill {
  cursor: pointer;
  font-family: inherit;
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

.race-rules-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(4, 24, 18, 0.6);
  overflow: auto;
}
.race-rules {
  width: min(560px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 22px 22px 18px;
  border-radius: 18px;
  background: var(--paper);
  color: var(--text);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
}
.race-rules-head h2 {
  margin: 2px 0 4px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 26px;
}
.race-rules-kicker {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #0f8b68;
}
.race-rules-lead {
  margin: 0;
  color: var(--muted);
}
.race-rules-you {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 14px 0 4px;
  padding: 10px 14px;
  border-radius: 12px;
  background: #0b3d2e;
  color: #fbf5e6;
  font-size: 14px;
}
.race-rules-you strong {
  color: #e9b949;
  font-size: 16px;
}
.race-rules h3 {
  margin: 16px 0 6px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.race-rules-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
  font-size: 14.5px;
  line-height: 1.45;
}
.race-rules-list li {
  position: relative;
  padding-left: 28px;
}
.race-rules-list li > span:first-child {
  position: absolute;
  left: 0;
}
.race-rules-list code {
  font-weight: 800;
}
.race-rules-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
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
