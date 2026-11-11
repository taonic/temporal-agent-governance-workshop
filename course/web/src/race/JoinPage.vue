<script setup>
// Joining the Derby (/join/<code>, or /join to type the code): your name, then build your jockey
// (a creature, silks, a horse name), and you're in the stalls. No email: the pit-pass it gives you
// gets you back in on another device. Then the course, as a racer (startRacing).
import { computed, onMounted, ref, watch } from "vue";

import Horse from "./Horse.vue";
import { COATS, CREATURES, HORSE_MAX, NAME_MAX, PATTERNS, SILKS, normalizeCode, suggestHorseName } from "./avatars.js";
import { startRacing } from "./racer.js";

const props = defineProps({ code: { type: String, default: "" } });

const code = ref(normalizeCode(props.code));
const typedCode = ref(code.value);
const info = ref(null);
const error = ref("");
const busy = ref(false);
const session = ref(null);

const name = ref("");
const creature = ref(CREATURES[Math.floor(Math.random() * CREATURES.length)].id);
const silks = ref("");
const pattern = ref(PATTERNS[0].id);
const horse = ref("");
const joined = ref(null); // { pitPass, race }

const pitPass = ref("");
const showResume = ref(false);

const taken = computed(() => new Set(info.value?.takenSilks ?? []));
const coat = COATS[Math.floor(Math.random() * COATS.length)];
const origin = window.location.host;

async function call(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}).`), { code: data.code });
  return data;
}

async function loadRace() {
  error.value = "";
  if (!code.value) return;
  try {
    info.value = await call(`/api/race/join?code=${encodeURIComponent(code.value)}`);
    if (!silks.value || taken.value.has(silks.value)) silks.value = SILKS.find((s) => !taken.value.has(s.id))?.id ?? "";
    if (!horse.value) horse.value = suggestHorseName(info.value.takenHorses);
    if (window.location.pathname !== `/join/${code.value}`) window.history.replaceState(null, "", `/join/${code.value}`);
  } catch (err) {
    info.value = null;
    error.value = err.message;
  }
}

function submitCode() {
  code.value = normalizeCode(typedCode.value);
  loadRace();
}

function randomise() {
  creature.value = CREATURES[Math.floor(Math.random() * CREATURES.length)].id;
  const free = SILKS.filter((s) => !taken.value.has(s.id));
  if (free.length) silks.value = free[Math.floor(Math.random() * free.length)].id;
  pattern.value = PATTERNS[Math.floor(Math.random() * PATTERNS.length)].id;
  horse.value = suggestHorseName([...(info.value?.takenHorses ?? []), horse.value]);
}

const canJoin = computed(() => name.value.trim() && horse.value.trim() && silks.value && !busy.value && info.value?.open && !info.value?.full);

async function join() {
  if (!canJoin.value) return;
  busy.value = true;
  error.value = "";
  try {
    joined.value = await call("/api/race/join", { code: code.value, name: name.value, horse: horse.value, creature: creature.value, silks: silks.value, pattern: pattern.value });
  } catch (err) {
    error.value = err.message;
    // Someone took the colour meanwhile: show what's free now.
    if (["silks_taken", "full"].includes(err.code)) await loadRace();
  } finally {
    busy.value = false;
  }
}

async function resume() {
  busy.value = true;
  error.value = "";
  try {
    const data = await call("/api/race/resume", { pitPass: pitPass.value });
    startRacing(data.race);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

const copied = ref(false);
async function copyPitPass() {
  try {
    await navigator.clipboard.writeText(joined.value.pitPass);
    copied.value = true;
  } catch {
    /* they can write it down */
  }
}

onMounted(async () => {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.title = "Join the Derby";
  call("/api/session").then((s) => (session.value = s)).catch(() => {});
  await loadRace();
});

watch(silks, () => (error.value = error.value.includes("colour") ? "" : error.value));
</script>

<template>
  <main class="join">
    <header class="join-head">
      <span class="join-logo" aria-hidden="true">🏇</span>
      <div>
        <p class="join-kicker">Temporal Quest · The Derby</p>
        <h1>{{ joined ? "You're in!" : info ? info.race.name : "Join the race" }}</h1>
      </div>
    </header>

    <!-- Joined: the pit-pass, then the stalls. -->
    <section v-if="joined" class="join-card join-done">
      <div class="join-preview"><Horse :creature="creature" :silks="silks" :pattern="pattern" :coat="coat" gait="trot" :label="horse" /></div>
      <p class="join-lead"><strong>{{ joined.race.horse }}</strong>, ridden by {{ joined.race.name }}, is heading to the stalls.</p>
      <div class="join-pitpass">
        <p>Your pit-pass</p>
        <code>{{ joined.pitPass }}</code>
        <button class="join-link" type="button" @click="copyPitPass">{{ copied ? "Copied ✓" : "Copy" }}</button>
      </div>
      <p class="join-note">Take a photo of it. If you switch device or lose this tab, open <strong>{{ origin }}/join</strong> and type it in to get your horse back.</p>
      <button class="join-go" type="button" @click="startRacing(joined.race)">To the stalls →</button>
    </section>

    <template v-else>
      <section v-if="session?.race && !showResume" class="join-card join-already">
        <p>You're already racing as <strong>{{ session.race.name }}</strong> on <strong>{{ session.race.horse }}</strong> in {{ session.race.raceName }}.</p>
        <button class="join-go" type="button" @click="startRacing(session.race)">Back to my race →</button>
      </section>

      <!-- No code yet (or a wrong one). -->
      <section v-if="!info" class="join-card">
        <form class="join-code-form" @submit.prevent="submitCode">
          <label for="join-code">The code on the big screen</label>
          <div class="join-row">
            <input id="join-code" v-model="typedCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="DERBY42" maxlength="16" />
            <button class="join-go" type="submit" :disabled="!typedCode.trim()">Go</button>
          </div>
        </form>
        <p v-if="error" class="join-error" role="alert">{{ error }}</p>
      </section>

      <form v-else class="join-card join-form" @submit.prevent="join">
        <p v-if="!info.open" class="join-error" role="alert">This race is over. Thanks for riding!</p>
        <p v-else-if="info.full" class="join-error" role="alert">The field is full: every stall is taken.</p>
        <p v-else-if="info.race.phase !== 'lobby'" class="join-note">The race has started: jump in, the clock is running!</p>
        <p v-if="session?.user && !session?.race" class="join-note">You're signed in as {{ session.user.name || session.user.email }}. Joining signs you in as a racer instead, on this browser.</p>

        <label class="join-label" for="join-name">Your name</label>
        <input id="join-name" v-model="name" :maxlength="NAME_MAX" autocomplete="given-name" placeholder="What the room calls you" required />

        <div class="join-builder">
          <div class="join-preview" :style="{ '--silks': SILKS.find((s) => s.id === silks)?.color }">
            <Horse :creature="creature" :silks="silks || 'silver'" :pattern="pattern" :coat="coat" gait="idle" :number="info.count + 1" :label="horse" />
            <p class="join-preview-name">{{ horse || "Your horse" }}</p>
          </div>
          <button class="join-dice" type="button" title="Randomise everything" @click="randomise">🎲 Surprise me</button>
        </div>

        <fieldset class="join-field">
          <legend>Your jockey</legend>
          <div class="join-creatures">
            <button
              v-for="c in CREATURES"
              :key="c.id"
              type="button"
              class="join-creature"
              :class="{ 'is-picked': creature === c.id }"
              :aria-pressed="creature === c.id"
              :title="c.label"
              @click="creature = c.id"
            >
              <span v-if="c.emoji" aria-hidden="true">{{ c.emoji }}</span>
              <svg v-else viewBox="-12 -12 24 24" aria-hidden="true"><circle r="8" fill="#c3d14a" stroke="#7a8a1d" /><g fill="#8a9a1f"><polygon v-for="i in 12" :key="i" :points="`0,-11 2,-7.5 -2,-7.5`" :transform="`rotate(${i * 30})`" /></g><circle cx="-2.6" cy="-1" r="1.1" fill="#222" /><circle cx="2.6" cy="-1" r="1.1" fill="#222" /><path d="M-2.6 2.4 Q0 4.8 2.6 2.4" stroke="#222" fill="none" /></svg>
              <small>{{ c.label }}</small>
            </button>
          </div>
        </fieldset>

        <fieldset class="join-field">
          <legend>Your silks <small>(one colour per rider)</small></legend>
          <div class="join-swatches">
            <button
              v-for="s in SILKS"
              :key="s.id"
              type="button"
              class="join-swatch"
              :class="{ 'is-picked': silks === s.id, 'is-taken': taken.has(s.id) }"
              :style="{ background: s.color }"
              :disabled="taken.has(s.id)"
              :aria-pressed="silks === s.id"
              :title="taken.has(s.id) ? `${s.label}: taken` : s.label"
              @click="silks = s.id"
            >
              <span v-if="taken.has(s.id)" aria-hidden="true">✕</span>
            </button>
          </div>
          <div class="join-patterns">
            <button v-for="p in PATTERNS" :key="p.id" type="button" class="join-chip" :class="{ 'is-picked': pattern === p.id }" :aria-pressed="pattern === p.id" @click="pattern = p.id">{{ p.label }}</button>
          </div>
        </fieldset>

        <label class="join-label" for="join-horse">Your horse's name</label>
        <div class="join-row">
          <input id="join-horse" v-model="horse" :maxlength="HORSE_MAX" required />
          <button class="join-reroll" type="button" title="Another name" @click="horse = suggestHorseName([...(info.takenHorses ?? []), horse])">🎲</button>
        </div>

        <p v-if="error" class="join-error" role="alert">{{ error }}</p>
        <button class="join-go join-submit" type="submit" :disabled="!canJoin">{{ busy ? "Saddling up…" : "Enter the stalls →" }}</button>
      </form>

      <section class="join-card join-resume">
        <button v-if="!showResume" class="join-link" type="button" @click="showResume = true">Already racing on another device? Use your pit-pass</button>
        <form v-else @submit.prevent="resume">
          <label class="join-label" for="join-pitpass">Your pit-pass</label>
          <div class="join-row">
            <input id="join-pitpass" v-model="pitPass" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="mango-gecko-42" />
            <button class="join-go" type="submit" :disabled="!pitPass.trim() || busy">Ride</button>
          </div>
          <p v-if="error && showResume" class="join-error" role="alert">{{ error }}</p>
        </form>
      </section>
    </template>
  </main>
</template>

<style>
html:has(.join),
body:has(.join) {
  background: #0b3d2e radial-gradient(ellipse 120% 600px at 50% -10%, #1d6b4f, #0b3d2e) no-repeat;
}

.join {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  color: #fbf5e6;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

.join-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.join-logo {
  font-size: 40px;
}
.join-kicker {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #e9b949;
}
.join-head h1 {
  margin: 2px 0 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 28px;
}

.join-card {
  margin-bottom: 14px;
  padding: 18px 16px;
  border-radius: 16px;
  background: var(--paper);
  color: var(--text);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.join-label,
.join-code-form label,
.join-field legend {
  display: block;
  margin: 14px 0 6px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.join-field legend small {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.join-label:first-of-type,
.join-code-form label {
  margin-top: 0;
}

.join input {
  width: 100%;
  padding: 12px 14px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 18px;
}
.join input:focus {
  outline: none;
  border-color: #0f8b68;
}
#join-code {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 800;
}

.join-row {
  display: flex;
  gap: 8px;
}

.join-go {
  flex: none;
  padding: 12px 18px;
  border: 0;
  border-radius: 12px;
  background: #0f8b68;
  color: #fff;
  font: inherit;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
}
.join-go:disabled {
  opacity: 0.45;
  cursor: default;
}
.join-submit {
  width: 100%;
  margin-top: 18px;
  padding: 16px;
  font-size: 19px;
  background: linear-gradient(180deg, #e9b949, #c98a1b);
  color: #3b2506;
}

.join-builder {
  position: relative;
  margin-top: 16px;
}
.join-preview {
  padding: 8px 18% 0;
  border-radius: 14px;
  background: linear-gradient(180deg, #bfe3c7 0 58%, #3f8f3a 58%);
}
.join-preview-name {
  margin: 0;
  padding: 2px 0 8px;
  text-align: center;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.join-dice {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.92);
  color: #0b3d2e;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.join-field {
  margin: 0;
  padding: 0;
  border: 0;
}

.join-creatures {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.join-creature {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 2px 6px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.join-creature span,
.join-creature svg {
  font-size: 26px;
  width: 30px;
  height: 30px;
  line-height: 30px;
  text-align: center;
}
.join-creature small {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.join-creature.is-picked {
  border-color: #0f8b68;
  background: var(--success-soft);
  transform: scale(1.04);
}

.join-swatches {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 6px;
}
.join-swatch {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border: 2px solid rgba(0, 0, 0, 0.15);
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  font-weight: 900;
}
.join-swatch.is-picked {
  outline: 3px solid var(--text);
  outline-offset: 2px;
}
.join-swatch.is-taken {
  opacity: 0.25;
  cursor: not-allowed;
}

.join-patterns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.join-chip {
  padding: 6px 12px;
  border: 2px solid var(--line);
  border-radius: 99px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.join-chip.is-picked {
  border-color: #0f8b68;
  background: var(--success-soft);
}

.join-reroll {
  flex: none;
  width: 52px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  font-size: 22px;
  cursor: pointer;
}

.join-error {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fde8e8;
  color: #9b1c1c;
  font-weight: 600;
}
.join-note {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 14px;
}

.join-link {
  padding: 0;
  border: 0;
  background: none;
  color: #0f8b68;
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.join-done {
  text-align: center;
}
.join-done .join-preview {
  margin-bottom: 12px;
}
.join-lead {
  font-size: 17px;
}
.join-pitpass {
  margin: 12px 0;
  padding: 14px;
  border: 2px dashed #e9b949;
  border-radius: 14px;
  background: var(--amber-soft);
}
.join-pitpass p {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.join-pitpass code {
  display: block;
  margin-bottom: 6px;
  font-size: 26px;
  font-weight: 900;
}
.join-done .join-go {
  width: 100%;
  margin-top: 8px;
  padding: 16px;
  font-size: 19px;
}
.join-already .join-go {
  margin-top: 8px;
}
.join-resume {
  background: rgba(255, 255, 255, 0.08);
  color: #fbf5e6;
  box-shadow: none;
}
.join-resume .join-link {
  color: #fbf5e6;
}
.join-resume .join-label {
  color: #b8d8c6;
}

@media (max-width: 420px) {
  .join-swatches {
    grid-template-columns: repeat(7, 1fr);
  }
}
</style>
