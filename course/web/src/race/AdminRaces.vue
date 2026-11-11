<script setup>
// /admin/events: the Derby, for the host. Make a race; share its join QR and its race screen; run
// it from here (on a phone at the side of the room, never on the projector): start it, give it
// five more minutes, end it, reveal the podium, mute it. Before the start, fill the field with
// ghosts to rehearse. Rename or remove a racer; reset the race, duplicate it, or delete it.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { api, toast } from "../store.js";
import Horse from "./Horse.vue";
import { clock, ordinal } from "./live.js";
import { joinUrl, qrSvg, raceUrl } from "./qr.js";

const races = ref([]);
const selectedId = ref(null);
const detail = ref(null);
const offset = ref(0);
const now = ref(Date.now());
const error = ref("");
const busy = ref(false);

const draft = ref({ name: "", durationMinutes: 75, joinCode: "", sound: true });
const editing = ref(false);
const settings = ref({});

const selected = computed(() => races.value.find((r) => r.id === selectedId.value) ?? null);
const race = computed(() => detail.value?.race ?? null);
const phase = computed(() => race.value?.phase ?? "lobby");
const lanes = computed(() => [...(detail.value?.racers ?? [])].sort((a, b) => a.lane - b.lane));
const real = computed(() => lanes.value.filter((r) => !r.ghost));
const readyCount = computed(() => real.value.filter((r) => r.sandbox === "ready").length);
const left = computed(() => (race.value?.clockEndsAt ? race.value.clockEndsAt - (now.value + offset.value) : null));
const stopTitle = (id) => detail.value?.course.stops.find((s) => s.id === id)?.short ?? "";

const PHASES = { lobby: "Lobby", countdown: "Starting", racing: "Racing", finished: "Finished" };
const SANDBOX = { ready: "✓ ready", none: "not started", error: "⚠ problem", full: "⚠ pool full", allowance: "⚠ out of time" };

async function loadList() {
  try {
    races.value = (await api("/api/admin/races")).races;
    if (!selectedId.value && races.value.length) selectedId.value = races.value[0].id;
  } catch (err) {
    error.value = err.message;
  }
}

async function loadDetail() {
  if (!selectedId.value) {
    detail.value = null;
    return;
  }
  try {
    const sent = Date.now();
    const data = await api(`/api/admin/race?id=${selectedId.value}`);
    offset.value = data.now - (sent + Date.now()) / 2;
    detail.value = data;
    if (!editing.value) settings.value = { name: data.race.name, durationMinutes: data.race.durationMinutes, joinCode: data.race.joinCode, sound: data.race.sound };
    error.value = "";
  } catch (err) {
    error.value = err.message;
  }
}

watch(selectedId, () => {
  detail.value = null;
  editing.value = false;
  loadDetail();
});

async function create() {
  busy.value = true;
  try {
    const made = await api("/api/admin/races", { method: "POST", body: draft.value });
    draft.value = { name: "", durationMinutes: 75, joinCode: "", sound: true };
    await loadList();
    selectedId.value = made.id;
    toast(`${made.name} is ready: share its code, ${made.joinCode}`);
  } catch (err) {
    toast(err.message, 4000);
  } finally {
    busy.value = false;
  }
}

async function save() {
  try {
    await api("/api/admin/races", { method: "POST", body: { id: selectedId.value, ...settings.value } });
    editing.value = false;
    await Promise.all([loadList(), loadDetail()]);
    toast("Saved");
  } catch (err) {
    toast(err.message, 4000);
  }
}

const CONFIRM = {
  start: () => (real.value.length && readyCount.value < real.value.length ? `Only ${readyCount.value} of ${real.value.length} sandboxes are ready. Start anyway?` : null),
  end: () => "End the race now? Scores freeze as they are.",
  podium: () => (phase.value === "finished" ? null : "End the race now and reveal the podium?"),
  reset: () => "Reset this race? Every racer (and their account and progress) is removed, and it goes back to the lobby.",
  delete: () => "Delete this race, and every racer in it? This can't be undone.",
};

async function act(action) {
  const question = CONFIRM[action]?.();
  if (question && !window.confirm(question)) return;
  busy.value = true;
  try {
    const out = await api("/api/admin/races/action", { method: "POST", body: { id: selectedId.value, action } });
    if (action === "delete") selectedId.value = null;
    if (action === "duplicate") selectedId.value = out.id;
    await Promise.all([loadList(), loadDetail()]);
    const said = { start: "And they're off! (in 3, 2, 1)", extend: "+5 minutes", end: "Race ended", podium: "Podium on the big screen", ghosts: `${out.racers} in the field`, reset: "Back to the lobby", duplicate: "Duplicated", delete: "Deleted", mute: "Muted", unmute: "Sound on" };
    toast(said[action] ?? "Done");
  } catch (err) {
    toast(err.message, 4000);
  } finally {
    busy.value = false;
  }
}

async function rename(r) {
  const name = window.prompt(`Rename ${r.name}`, r.name);
  if (!name || name === r.name) return;
  try {
    await api("/api/admin/racers", { method: "POST", body: { id: r.id, name } });
    loadDetail();
  } catch (err) {
    toast(err.message, 4000);
  }
}

async function remove(r) {
  if (!window.confirm(`Remove ${r.name} (${r.horse}) from the race? Their account and progress go too.`)) return;
  try {
    await api(`/api/admin/racers?id=${r.id}`, { method: "DELETE" });
    loadDetail();
    loadList();
  } catch (err) {
    toast(err.message, 4000);
  }
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    window.prompt(`Copy the ${what.toLowerCase()}:`, text);
  }
}

const qr = computed(() => (race.value ? qrSvg(joinUrl(race.value.joinCode)) : ""));
const status = (r) => {
  if (r.finishedAt) return `🏁 ${clock(r.finishedAt - race.value.startedAt)}`;
  if (phase.value === "lobby" || phase.value === "countdown") return r.ghost ? "👻 ghost" : (SANDBOX[r.sandbox] ?? `${r.sandbox ?? "…"}`);
  if (r.grazing) return "🌿 grazing";
  return r.stop ? `at ${stopTitle(r.stop)}` : "at the gate";
};

let fast = 0;
let slow = 0;
onMounted(async () => {
  await loadList();
  loadDetail();
  fast = setInterval(() => {
    now.value = Date.now();
    if (document.visibilityState === "visible" && !editing.value && Math.floor(now.value / 1000) % 2 === 0) loadDetail();
  }, 1000);
  slow = setInterval(() => document.visibilityState === "visible" && loadList(), 15_000);
});
onBeforeUnmount(() => {
  clearInterval(fast);
  clearInterval(slow);
});
</script>

<template>
  <section class="admin-section admin-cohorts admin-races">
    <aside class="admin-card cohort-list">
      <form class="admin-form race-new" @submit.prevent="create">
        <h3>New race</h3>
        <label>Name <input v-model="draft.name" type="text" required maxlength="60" placeholder="Phuket Derby"></label>
        <label>Duration, minutes <input v-model.number="draft.durationMinutes" type="number" min="5" max="600" required></label>
        <label>Join code <input v-model="draft.joinCode" type="text" maxlength="16" placeholder="made up for you" style="text-transform: uppercase"></label>
        <label class="race-check"><input v-model="draft.sound" type="checkbox"> Sound on the race screen</label>
        <div class="admin-form-actions"><button class="button button-primary" type="submit" :disabled="busy || !draft.name.trim()">Create race</button></div>
      </form>
      <button
        v-for="r in races"
        :key="r.id"
        type="button"
        class="cohort-item"
        :class="{ active: r.id === selectedId }"
        @click="selectedId = r.id"
      >
        <strong>🏇 {{ r.name }}</strong>
        <span class="admin-muted">{{ r.joinCode }} · {{ r.racerCount }} {{ r.racerCount === 1 ? "racer" : "racers" }} · {{ r.startedAt ? (r.endedAt || r.podiumAt ? "ended" : "started") : "lobby" }}</span>
      </button>
      <p v-if="!races.length" class="admin-muted">No races yet. Make one, then fill it with ghosts to rehearse.</p>
    </aside>

    <div v-if="detail && selected" class="cohort-detail">
      <div class="admin-card race-head">
        <div>
          <h3>{{ race.name }} <span class="race-phase" :class="`is-${phase}`">{{ PHASES[phase] }}</span></h3>
          <p class="admin-muted">
            {{ race.durationMinutes }} min<template v-if="race.extraMinutes"> + {{ race.extraMinutes }}</template> ·
            {{ lanes.length }} in the field<template v-if="real.length && (phase === 'lobby' || phase === 'countdown')"> · {{ readyCount }}/{{ real.length }} sandboxes ready</template>
          </p>
        </div>
        <p v-if="phase === 'racing'" class="race-clock" :class="{ 'is-final': left <= 600_000 }">⏱ {{ clock(left) }}</p>
      </div>

      <div class="admin-card race-controls">
        <button v-if="phase === 'lobby'" class="button button-primary race-big" type="button" :disabled="busy || !lanes.length" @click="act('start')">🏁 Start the race</button>
        <button v-if="phase === 'racing'" class="button" type="button" :disabled="busy" @click="act('extend')">+5 min</button>
        <button v-if="phase === 'racing'" class="button" type="button" :disabled="busy" @click="act('end')">End now</button>
        <button v-if="phase === 'racing' || phase === 'finished'" class="button button-primary" type="button" :disabled="busy" @click="act('podium')">🏆 Reveal podium</button>
        <button class="button" type="button" :disabled="busy" @click="act(race.sound ? 'mute' : 'unmute')">{{ race.sound ? "🔇 Mute" : "🔊 Unmute" }}</button>
        <button v-if="phase === 'lobby'" class="button" type="button" :disabled="busy || lanes.length >= 15" @click="act('ghosts')">👻 Fill with ghosts</button>
        <span class="race-spacer" />
        <button class="button" type="button" :disabled="busy" @click="act('reset')">Reset</button>
        <button class="button" type="button" :disabled="busy" @click="act('duplicate')">Duplicate</button>
        <button class="button" type="button" :disabled="busy" @click="act('delete')">Delete</button>
      </div>

      <div class="admin-card race-share">
        <div class="race-qr" v-html="qr" />
        <div class="race-links">
          <p class="race-code">{{ race.joinCode }}</p>
          <p>
            <strong>Join link</strong><br>
            <code>{{ joinUrl(race.joinCode) }}</code>
            <button class="link-button" type="button" @click="copy(joinUrl(race.joinCode), 'Join link')">Copy</button>
          </p>
          <p>
            <strong>Race screen</strong> (for the projector: no sign-in)<br>
            <a :href="raceUrl(race.slug)" target="_blank" rel="noopener"><code>{{ raceUrl(race.slug) }}</code></a>
            <button class="link-button" type="button" @click="copy(raceUrl(race.slug), 'Race screen link')">Copy</button>
          </p>
          <p class="admin-muted">Click the race screen once to turn its sound on: browsers won't play sound before a click.</p>
        </div>
      </div>

      <div class="admin-card">
        <h3>The field</h3>
        <table v-if="lanes.length" class="admin-table race-field">
          <thead>
            <tr><th>Stall</th><th /><th>Horse · rider</th><th>Place</th><th>XP</th><th>Status</th><th>Pit-pass</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="r in lanes" :key="r.id">
              <td>{{ r.lane + 1 }}</td>
              <td class="race-mini"><Horse :creature="r.creature" :silks="r.silks" :pattern="r.pattern" :coat="r.coat" :number="r.lane + 1" :gait="r.grazing ? 'graze' : 'idle'" /></td>
              <td><strong>{{ r.horse }}</strong><br><span class="admin-muted">{{ r.ghost ? "👻 " : "" }}{{ r.name }}</span></td>
              <td>{{ phase === "lobby" ? "" : ordinal(r.rank) }}</td>
              <td>{{ r.xp }}<span v-if="r.stumbles" class="admin-muted"> · {{ r.stumbles }} 😬</span></td>
              <td>{{ status(r) }}</td>
              <td><code v-if="r.pitPass">{{ r.pitPass }}</code></td>
              <td class="race-row-actions">
                <button v-if="!r.ghost" class="link-button" type="button" @click="rename(r)">Rename</button>
                <button class="link-button" type="button" @click="remove(r)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="admin-muted">Nobody yet. Put the race screen up: its QR lets people join.</p>
      </div>

      <form class="admin-card admin-form" @submit.prevent="save" @input="editing = true">
        <h3>Settings</h3>
        <label>Name <input v-model="settings.name" type="text" required maxlength="60"></label>
        <label>Duration, minutes <input v-model.number="settings.durationMinutes" type="number" min="5" max="600" required></label>
        <label>Join code <input v-model="settings.joinCode" type="text" maxlength="16" required style="text-transform: uppercase"></label>
        <label class="race-check"><input v-model="settings.sound" type="checkbox" @change="editing = true"> Sound on the race screen</label>
        <div class="admin-form-actions">
          <button class="button button-primary" type="submit" :disabled="!editing">Save</button>
          <button v-if="editing" class="button" type="button" @click="editing = false; loadDetail()">Cancel</button>
        </div>
      </form>
    </div>
    <p v-else-if="error" class="form-error">{{ error }}</p>
  </section>
</template>

<style>
.admin-races .race-new h3 {
  margin-top: 0;
}
.race-check {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 8px;
}
.race-check input {
  width: auto !important;
}
.race-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.race-head h3 {
  margin: 0 0 4px;
}
.race-phase {
  margin-left: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  vertical-align: middle;
  background: var(--mist);
  color: var(--muted);
}
.race-phase.is-racing,
.race-phase.is-countdown {
  background: var(--success-soft);
  color: var(--success);
}
.race-phase.is-finished {
  background: var(--amber-soft);
  color: var(--amber);
}
.race-clock {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.race-clock.is-final {
  color: var(--danger);
}
.race-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.race-big {
  font-size: 16px;
  padding: 10px 18px;
}
.race-spacer {
  flex: 1;
}
.race-share {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.race-qr {
  width: 168px;
  flex: none;
}
.race-qr svg {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 8px;
}
.race-links {
  flex: 1;
  min-width: 240px;
}
.race-links p {
  margin: 0 0 10px;
  overflow-wrap: anywhere;
}
.race-links .link-button {
  margin-left: 10px;
}
.race-code {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 0.1em;
}
.race-field td {
  vertical-align: middle;
}
.race-mini {
  width: 64px;
}
.race-mini .horse {
  width: 60px;
}
.race-row-actions {
  white-space: nowrap;
}
.race-row-actions .link-button + .link-button {
  margin-left: 10px;
}
</style>
