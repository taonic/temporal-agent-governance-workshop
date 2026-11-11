<script setup>
// The race screen (/race/<slug>), for the projector: no sign-in, no controls. A straight track, a
// lane per racer, each horse as far down it as its XP (the boss is the finish post); standings and
// a commentary ticker beside it; the clock across the top. Before the start, the join QR and the
// horses in their stalls; at the end, the podium.
//
// What moves, moves because the race changed between two polls (onState): a gain gallops, a wrong
// pick stumbles, a badge pops over the jockey, an overtake goes in the ticker, a finish flashes.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import { medalSvg } from "../badgeArt.js";
import { launchConfetti } from "../confetti.js";
import Horse from "./Horse.vue";
import { clock, live, ordinal, serverNow, watchRace } from "./live.js";
import { joinUrl, qrSvg } from "./qr.js";
import * as sound from "./sound.js";
import { silksOf } from "./avatars.js";

const props = defineProps({ slug: { type: String, required: true } });

const FINAL_MS = 10 * 60_000;
const now = ref(serverNow());
const state = computed(() => live.state);
const race = computed(() => state.value?.race ?? null);
const phase = computed(() => race.value?.phase ?? "lobby");
const stops = computed(() => state.value?.course.stops ?? []);
const maxXp = computed(() => state.value?.course.maxXp || 1);
const lanes = computed(() => [...(state.value?.racers ?? [])].sort((a, b) => a.lane - b.lane));
const standings = computed(() => [...(state.value?.racers ?? [])].sort((a, b) => a.rank - b.rank));
const stopById = computed(() => new Map(stops.value.map((s) => [s.id, s])));
const left = computed(() => (race.value?.clockEndsAt ? race.value.clockEndsAt - now.value : null));
const finalFurlong = computed(() => phase.value === "racing" && left.value !== null && left.value <= FINAL_MS);
const countdown = computed(() => (phase.value === "countdown" ? Math.max(1, Math.ceil((race.value.startedAt - now.value) / 1000)) : null));
const podiumOpen = computed(() => phase.value === "finished" && race.value?.podiumAt && now.value >= race.value.podiumAt);
const qr = computed(() => (race.value ? qrSvg(joinUrl(race.value.joinCode), { label: `Join at ${joinUrl(race.value.joinCode)}` }) : ""));
const joinHost = computed(() => `${window.location.host}/join`);

const clockText = computed(() => {
  if (!race.value) return "";
  if (phase.value === "lobby") return `${race.value.durationMinutes + race.value.extraMinutes} min`;
  if (phase.value === "countdown") return clock((race.value.durationMinutes + race.value.extraMinutes) * 60_000);
  if (phase.value === "finished") return "Finished";
  return clock(left.value);
});

// --- Effects, per racer --------------------------------------------------------------------------

const fx = reactive({}); // racer id -> { gait, until, floats: [], pops: [], entering }
const ticker = ref([]);
const flash = ref(null); // { key, text }
const banner = ref(null); // { key, text }
let seq = 0;

const fxOf = (id) => (fx[id] ??= { gait: null, until: 0, floats: [], pops: [], entering: false });

function gaitFor(r) {
  const f = fx[r.id];
  if (f?.gait && f.until > now.value) return f.gait;
  if (r.grazing) return "graze";
  return "idle";
}

function setGait(id, gait, ms) {
  const f = fxOf(id);
  // A stumble isn't cut short by a gallop that comes with it.
  if (f.gait === "stumble" && f.until > serverNow() && gait === "gallop") ms += 1100;
  f.gait = gait;
  f.until = serverNow() + ms;
}

function float(id, text, big = false) {
  const key = ++seq;
  fxOf(id).floats.push({ key, text, big });
  setTimeout(() => (fx[id].floats = fx[id].floats.filter((x) => x.key !== key)), 2600);
}

function pop(id, badge) {
  const key = ++seq;
  fxOf(id).pops.push({ key, badge, svg: medalSvg(badge, { earned: true, size: 64, label: badge.name }) });
  setTimeout(() => (fx[id].pops = fx[id].pops.filter((x) => x.key !== key)), 3400);
}

function say(text, tone = "") {
  ticker.value = [{ key: ++seq, text, tone }, ...ticker.value].slice(0, 7);
}

function showBanner(text, ms = 2200) {
  const key = ++seq;
  banner.value = { key, text };
  setTimeout(() => banner.value?.key === key && (banner.value = null), ms);
}

// A stop's name mid-sentence: "the seat hold", but "The Night Shift".
const phrase = (stop) => (stop?.short ?? "").replace(/^The (?=[a-z])/, "the ");
const where = (r) => (stopById.value.get(r.stop) ? phrase(stopById.value.get(r.stop)) : "the gate");

// What changed since the last poll, and what to show for it.
let prev = null; // { phase, final, racers: Map(id -> snapshot) }
function onState(next) {
  if (!next) return;
  const r0 = next.race;
  const snap = (r) => ({ xp: r.xp, stumbles: r.stumbles, badges: new Set(r.badges), finishedAt: r.finishedAt, rank: r.rank, grazing: r.grazing });
  const racers = new Map(next.racers.map((r) => [r.id, snap(r)]));
  const final = r0.phase === "racing" && r0.clockEndsAt - next.now <= FINAL_MS;
  if (!prev || (prev.phase !== "lobby" && r0.phase === "lobby")) {
    // The first look (or a reset): nothing to animate, only the welcome.
    if (prev) {
      ticker.value = [];
      podiumStep.value = 0;
    }
    prev = { phase: r0.phase, final, racers };
    if (!ticker.value.length) say(r0.phase === "lobby" ? "🎺 Riders, to your stalls! Scan the code to join." : r0.phase === "finished" ? "🏁 The race is over." : "🏇 The race is on!");
    return;
  }

  // The field.
  for (const r of next.racers) {
    const p = prev.racers.get(r.id);
    if (!p) {
      if (["lobby", "countdown"].includes(r0.phase)) {
        fxOf(r.id).entering = true;
        setGait(r.id, "trot", 1900);
        setTimeout(() => fx[r.id] && (fx[r.id].entering = false), 50);
        say(`🐴 ${r.horse} enters stall ${r.lane + 1}, ridden by ${r.name}`);
        sound.hooves(2);
      }
      continue;
    }
    if (r.xp > p.xp) {
      const amount = r.xp - p.xp;
      const stop = stopById.value.get(r.stop);
      setGait(r.id, "gallop", 2900);
      float(r.id, `+${amount}`, amount >= 20);
      if (stop?.kind === "boss") say(`🌙 ${r.horse} beats ${phrase(stop)}! +${amount}`, "big");
      else if (stop?.kind === "challenge" && amount >= 20) say(`⚡ ${r.horse} nails ${phrase(stop)} first time! +${amount}`, "big");
      else say(`${stop?.emoji ?? "🐎"} ${r.horse} clears ${stop ? phrase(stop) : "a stop"}. +${amount}`);
      sound.hooves(amount >= 20 ? 5 : 3);
    }
    if (r.stumbles > p.stumbles) {
      setGait(r.id, "stumble", 1150);
      say(`😬 ${r.horse} stumbles at ${stopAhead(r)}!`, "oops");
      sound.thud();
    }
    for (const id of r.badges) {
      if (p.badges.has(id)) continue;
      const badge = next.badges[id];
      if (!badge) continue;
      pop(r.id, badge);
      if (badge.kind !== "skill" || ["clean-run", "flawless"].includes(badge.id)) say(`🏅 ${r.horse} earns ${badge.name}`, "badge");
      sound.chime();
    }
    if (r.finishedAt && !p.finishedAt) {
      const close = next.racers.some((o) => o.id !== r.id && o.finishedAt && Math.abs(o.finishedAt - r.finishedAt) < 3000);
      flash.value = { key: ++seq, text: close ? "📸 PHOTO FINISH!" : `🏁 ${r.horse}` };
      setTimeout(() => (flash.value = null), 1400);
      say(`🏁 ${r.horse} crosses the line, ${ordinal(r.rank)}!`, "big");
      sound.fanfare();
    }
    if (r.grazing && !p.grazing) say(`🌿 ${r.horse} has stopped for a snack…`, "oops");
  }

  // Overtakes: a racer who went from behind another to ahead of them.
  let passes = 0;
  for (const a of next.racers) {
    const pa = prev.racers.get(a.id);
    if (!pa || a.rank >= pa.rank) continue;
    for (const b of next.racers) {
      const pb = prev.racers.get(b.id);
      if (!pb || b.id === a.id || passes >= 2) continue;
      // Passing a horse still in the gate isn't news.
      if (pb.rank < pa.rank && b.rank > a.rank && b.xp > 0) {
        say(`🔥 ${a.horse} passes ${b.horse} at ${where(a)}!`, "pass");
        passes++;
      }
    }
  }

  // The race.
  if (prev.phase === "lobby" && r0.phase === "countdown") {
    say("🎺 The call to the post…");
    sound.bugle();
  }
  if (["lobby", "countdown"].includes(prev.phase) && r0.phase === "racing") goNow();
  if (final && !prev.final) {
    say("🔔 The final furlong! Ten minutes left!", "big");
    showBanner("🔔 FINAL FURLONG");
    sound.bell();
  }
  if (prev.phase !== "finished" && r0.phase === "finished") {
    say("🏁 The race is over! The podium in a moment…", "big");
    showBanner("🏁 RACE OVER", 3500);
    sound.roar(4, 0.22);
  }
  prev = { phase: r0.phase, final, racers };
}

// The stop a racer is at: the one after the last they passed.
function stopAhead(r) {
  const i = stops.value.findIndex((s) => s.id === r.stop);
  const stop = stops.value[i + 1] ?? stops.value.at(-1);
  return stop ? phrase(stop) : "the gate";
}

function goNow() {
  showBanner("AND THEY'RE OFF!", 2000);
  say("🏇 And they're off!", "big");
  sound.crowdStart();
  sound.roar(3);
}

watch(() => live.state, onState);

// --- The podium ------------------------------------------------------------------------------

const podiumStep = ref(0); // 0: nothing yet; 1: 3rd; 2: 2nd; 3: 1st
const podium = computed(() => standings.value.slice(0, 3));
const alsoRan = computed(() => standings.value.slice(3));
let podiumTimers = [];
watch(podiumOpen, (open) => {
  podiumTimers.forEach(clearTimeout);
  podiumTimers = [];
  if (!open) {
    podiumStep.value = 0;
    return;
  }
  const steps = podium.value.length;
  const reveal = (step, at) => podiumTimers.push(setTimeout(() => {
    podiumStep.value = step;
    if (step === 3 || (step === steps && steps < 3)) {
      launchConfetti({ count: 260, duration: 6000 });
      sound.fanfare();
    } else sound.chime();
  }, at));
  // 3rd, then 2nd, then 1st (fewer when fewer ran).
  if (steps >= 3) reveal(1, 900);
  if (steps >= 2) reveal(2, steps >= 3 ? 2800 : 900);
  reveal(3, steps >= 3 ? 5000 : steps === 2 ? 3000 : 900);
});
const revealed = (place) => (place === 3 ? podiumStep.value >= 1 : place === 2 ? podiumStep.value >= 2 : podiumStep.value >= 3);

// --- Sound -------------------------------------------------------------------------------------

const soundOn = ref(false);
async function enableSound() {
  soundOn.value = await sound.unlock();
  if (soundOn.value && phase.value === "racing") sound.crowdStart();
}
watch(() => race.value?.sound, (on) => sound.setMuted(on === false), { immediate: true });

// --- Layout --------------------------------------------------------------------------------------

const laneCount = computed(() => Math.max(lanes.value.length, 8));
const progressOf = (r) => Math.min(1, r.xp / maxXp.value);

let ticking = 0;
onMounted(() => {
  document.documentElement.dataset.theme = "light";
  document.title = "The Derby";
  watchRace(props.slug, 1500);
  ticking = setInterval(() => (now.value = serverNow()), 250);
  window.addEventListener("pointerdown", enableSound);
  window.addEventListener("keydown", enableSound);
});
onBeforeUnmount(() => {
  clearInterval(ticking);
  window.removeEventListener("pointerdown", enableSound);
  window.removeEventListener("keydown", enableSound);
});
watch(race, (r) => r && (document.title = `${r.name} · The Derby`));

const medal = (rank) => ["🥇", "🥈", "🥉"][rank - 1] ?? "";
const silks = (r) => silksOf(r.silks);
const finishedTime = (r) => (r.finishedAt && race.value?.startedAt ? clock(r.finishedAt - race.value.startedAt) : "");
</script>

<template>
  <div class="derby" :class="[`phase-${phase}`, { 'is-final': finalFurlong }]" :style="{ '--n': laneCount }">
    <header class="derby-head">
      <div class="derby-title">
        <span class="derby-logo" aria-hidden="true">🏇</span>
        <span>
          <strong>{{ race?.name ?? "The Derby" }}</strong>
          <small>Temporal Quest · Essentials</small>
        </span>
      </div>
      <div class="derby-clock" :class="{ 'is-final': finalFurlong }" role="timer">
        <small>{{ phase === "racing" ? "left" : phase === "lobby" ? "race" : phase === "countdown" ? "on the clock" : "" }}</small>
        <span>⏱ {{ clockText }}</span>
      </div>
    </header>

    <p v-if="live.error && !state" class="derby-empty">{{ live.error }}</p>

    <main v-else-if="state" class="derby-body">
      <section class="derby-track" aria-label="The track">
        <div class="derby-posts" aria-hidden="true">
          <div class="derby-gate-line" />
          <div v-for="s in stops" :key="s.id" class="derby-post" :class="[`is-${s.kind}`]" :style="{ '--p': s.at / maxXp }">
            <span class="derby-post-label"><span class="derby-post-emoji">{{ s.emoji }}</span>{{ s.short }}</span>
          </div>
          <div class="derby-enclosure"><span>Winner's enclosure</span></div>
        </div>

        <p v-if="!lanes.length" class="derby-waiting">Waiting for riders… scan the code to join →</p>

        <div
          v-for="r in lanes"
          :key="r.id"
          class="derby-lane"
          :class="{ 'is-finished': r.finishedAt, 'is-ghost': r.ghost }"
        >
          <div class="derby-lane-label">
            <span class="derby-stall" :style="{ background: silks(r).color, color: silks(r).ink }">{{ r.lane + 1 }}</span>
            <span class="derby-lane-names">
              <strong>{{ r.horse }}</strong>
              <small>{{ r.ghost ? "👻 " : "" }}{{ r.name }}</small>
            </span>
          </div>
          <div class="derby-run">
            <div class="derby-gate" :class="{ 'is-open': ['racing', 'finished'].includes(phase) }" aria-hidden="true" />
            <div
              class="derby-runner"
              :class="{ 'is-entering': fx[r.id]?.entering, 'is-home': r.finishedAt }"
              :style="{ '--p': progressOf(r) }"
            >
              <Horse :creature="r.creature" :silks="r.silks" :pattern="r.pattern" :coat="r.coat" :number="r.lane + 1" :gait="gaitFor(r)" :label="`${r.horse}, ridden by ${r.name}`" />
              <span v-for="f in fx[r.id]?.floats ?? []" :key="f.key" class="derby-float" :class="{ 'is-big': f.big }">{{ f.text }}</span>
              <span v-for="b in fx[r.id]?.pops ?? []" :key="b.key" class="derby-pop" v-html="b.svg" />
              <span v-if="r.finishedAt" class="derby-rosette" :title="`${ordinal(r.rank)}`">{{ r.rank }}</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="derby-side">
        <template v-if="phase === 'lobby' || phase === 'countdown'">
          <div class="derby-join">
            <p class="derby-kicker">Join the race</p>
            <div class="derby-qr" v-html="qr" />
            <p class="derby-join-url">{{ joinHost }}</p>
            <p class="derby-code">{{ race.joinCode }}</p>
            <p class="derby-count">{{ lanes.length }} {{ lanes.length === 1 ? "rider" : "riders" }} in the stalls</p>
          </div>
        </template>
        <template v-else>
          <div class="derby-standings">
            <p class="derby-kicker">Standings</p>
            <TransitionGroup tag="ol" name="standing" class="derby-standings-list">
              <li v-for="r in standings" :key="r.id" :class="{ 'is-top': r.xp && r.rank <= 3, 'is-home': r.finishedAt }">
                <span class="derby-rank">{{ (r.xp && medal(r.rank)) || r.rank }}</span>
                <span class="derby-swatch" :style="{ background: silks(r).color }" />
                <span class="derby-standing-names"><strong>{{ r.horse }}</strong><small>{{ r.name }}</small></span>
                <span class="derby-xp">{{ r.finishedAt ? "🏁 " : "" }}{{ r.xp }}<small>XP</small></span>
              </li>
            </TransitionGroup>
          </div>
        </template>
        <div class="derby-ticker" :class="{ 'is-final': finalFurlong }">
          <p class="derby-kicker">{{ finalFurlong ? "🔔 Final furlong" : "Commentary" }}</p>
          <TransitionGroup tag="ul" name="tick">
            <li v-for="t in ticker" :key="t.key" :class="t.tone && `is-${t.tone}`">{{ t.text }}</li>
          </TransitionGroup>
        </div>
      </aside>
    </main>

    <!-- 3, 2, 1 -->
    <div v-if="countdown" class="derby-countdown" aria-live="assertive">
      <span :key="countdown">{{ countdown }}</span>
    </div>
    <div v-if="banner" :key="banner.key" class="derby-banner" aria-live="polite">{{ banner.text }}</div>
    <div v-if="flash" :key="flash.key" class="derby-flash"><span>{{ flash.text }}</span></div>

    <!-- The podium: 3rd, then 2nd, then 1st. -->
    <div v-if="podiumOpen" class="derby-podium" aria-live="polite">
      <h2>🏆 {{ race.name }}: the results</h2>
      <div class="derby-podium-stage">
        <div
          v-for="(r, i) in podium"
          :key="r.id"
          class="derby-step"
          :class="[`place-${i + 1}`, { 'is-shown': revealed(i + 1) }]"
        >
          <div class="derby-step-horse"><Horse :creature="r.creature" :silks="r.silks" :pattern="r.pattern" :coat="r.coat" :number="r.lane + 1" :gait="i === 0 && revealed(1) ? 'gallop' : 'idle'" /></div>
          <p class="derby-step-name"><strong>{{ r.horse }}</strong><span>{{ r.name }}</span></p>
          <p class="derby-step-score">{{ r.xp }} XP<span v-if="finishedTime(r)"> · {{ finishedTime(r) }}</span></p>
          <div class="derby-step-block"><span>{{ medal(i + 1) }}</span>{{ ordinal(i + 1) }}</div>
        </div>
      </div>
      <ol v-if="alsoRan.length && podiumStep >= 3" class="derby-also" :start="4">
        <li v-for="r in alsoRan" :key="r.id"><span>{{ ordinal(r.rank) }}</span> {{ r.horse }} <small>{{ r.name }} · {{ r.xp }} XP</small></li>
      </ol>
    </div>

    <button v-if="race?.sound && !soundOn" class="derby-sound" type="button" @click="enableSound">🔈 Click anywhere to turn on the sound</button>
  </div>
</template>

<style>
body:has(.derby) {
  background: #0b3d2e;
  overflow: hidden;
}

.derby {
  --head-h: 9vh;
  --label-w: 15vw;
  --side-w: 23vw;
  --top: 10.5vh;
  --lane-h: calc((100vh - var(--head-h) - var(--top)) / var(--n));
  --hw: calc(var(--lane-h) * 1.32);
  --encl: calc(var(--hw) + 1.2vw);
  --turf-a: #3f8f3a;
  --turf-b: #378533;
  --cream: #fbf5e6;
  --gold: #e9b949;
  --gold-hi: #fcd34d;
  --paper: #fffdf7;
  --mist: #eef2f7;
  --text: #1f2937;
  --branch-green: #0f8b68;
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: radial-gradient(ellipse at 50% -20%, #1d6b4f 0%, #0b3d2e 60%);
  color: var(--cream);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  user-select: none;
}

.derby-head {
  height: var(--head-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2vw;
  border-bottom: 0.4vh solid var(--gold);
  background: linear-gradient(180deg, #08291f, #0b3d2e);
}

.derby-title {
  display: flex;
  align-items: center;
  gap: 1vw;
}
.derby-logo {
  font-size: 5.2vh;
}
.derby-title strong {
  display: block;
  font-size: 3.6vh;
  letter-spacing: 0.02em;
  font-family: Georgia, "Times New Roman", serif;
}
.derby-title small {
  display: block;
  font-size: 1.7vh;
  color: #b8d8c6;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.derby-clock {
  display: flex;
  align-items: baseline;
  gap: 0.8vw;
  font-variant-numeric: tabular-nums;
  font-size: 5vh;
  font-weight: 800;
  padding: 0.6vh 1.4vw;
  border-radius: 1.4vh;
  background: rgba(0, 0, 0, 0.3);
  border: 0.25vh solid rgba(233, 185, 73, 0.5);
}
.derby-clock small {
  font-size: 1.8vh;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #b8d8c6;
}
.derby-clock.is-final {
  color: #fff;
  background: #b91c1c;
  border-color: #fecaca;
  animation: derby-pulse 1s ease-in-out infinite;
}

.derby-empty {
  margin: auto;
  font-size: 3vh;
}

.derby-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr var(--side-w);
  min-height: 0;
}

/* --- The track ------------------------------------------------------------------------------- */

.derby-track {
  position: relative;
  padding-top: var(--top);
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.035) 0 4vw, transparent 4vw 8vw),
    var(--turf-a);
  overflow: hidden;
}

.derby-posts {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--label-w);
  right: 0;
  pointer-events: none;
}

.derby-post,
.derby-gate-line {
  position: absolute;
  top: calc(var(--top) - 1vh);
  bottom: 0;
  left: calc(var(--hw) + var(--p, 0) * (100% - var(--hw) - var(--encl)));
  width: 0;
  border-left: 0.25vw dashed rgba(255, 255, 255, 0.4);
}
.derby-gate-line {
  border-left: 0.35vw solid rgba(255, 255, 255, 0.8);
}
.derby-post.is-boss {
  width: 1.1vw;
  margin-left: -0.55vw;
  border: 0;
  background: repeating-conic-gradient(#111 0 25%, #fff 0 50%) 0 0 / 1.1vw 1.1vw;
  box-shadow: 0 0 1vw rgba(0, 0, 0, 0.4);
}
.derby-post-label {
  position: absolute;
  bottom: 100%;
  left: -0.9vh;
  transform-origin: 0.9vh 100%;
  transform: rotate(-38deg);
  display: flex;
  align-items: center;
  gap: 0.4vh;
  font-size: 1.45vh;
  font-weight: 700;
  line-height: 1;
  color: #eaf7ee;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
}
.derby-post-emoji {
  font-size: 1.8vh;
}
.derby-post.is-boss .derby-post-label {
  font-size: 1.6vh;
  color: var(--gold-hi);
}

.derby-enclosure {
  position: absolute;
  top: calc(var(--top) - 1vh);
  bottom: 0;
  right: 0;
  width: calc(var(--encl) - 0.6vw);
  background: repeating-linear-gradient(135deg, rgba(233, 185, 73, 0.18) 0 1vw, rgba(233, 185, 73, 0.08) 1vw 2vw);
  border-left: 0.2vw solid rgba(233, 185, 73, 0.6);
}
.derby-enclosure span {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
  white-space: nowrap;
  font-size: 1.4vh;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgba(252, 211, 77, 0.55);
}

.derby-waiting {
  position: absolute;
  inset: 40% 0 auto;
  text-align: center;
  font-size: 3.2vh;
  font-weight: 700;
  color: #eaf7ee;
  animation: derby-pulse 2s ease-in-out infinite;
}

.derby-lane {
  position: relative;
  display: grid;
  grid-template-columns: var(--label-w) 1fr;
  height: var(--lane-h);
  border-bottom: 0.2vh solid rgba(255, 255, 255, 0.55);
}
.derby-lane:nth-of-type(even) {
  background: rgba(0, 0, 0, 0.06);
}
.derby-lane:first-of-type {
  border-top: 0.2vh solid rgba(255, 255, 255, 0.55);
}

.derby-lane-label {
  display: flex;
  align-items: center;
  gap: 0.6vw;
  padding: 0 0.6vw;
  background: rgba(6, 40, 28, 0.82);
  border-right: 0.3vw solid #fff;
  z-index: 2;
  min-width: 0;
}
.derby-stall {
  flex: none;
  display: grid;
  place-items: center;
  width: calc(var(--lane-h) * 0.62);
  height: calc(var(--lane-h) * 0.62);
  max-width: 4.4vh;
  max-height: 4.4vh;
  border-radius: 50%;
  font-weight: 900;
  font-size: min(calc(var(--lane-h) * 0.34), 2.3vh);
  border: 0.2vh solid rgba(255, 255, 255, 0.85);
}
.derby-lane-names {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.12;
}
.derby-lane-names strong {
  font-size: min(calc(var(--lane-h) * 0.32), 2.2vh);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.derby-lane-names small {
  font-size: min(calc(var(--lane-h) * 0.24), 1.6vh);
  color: #b8d8c6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.derby-run {
  position: relative;
}

.derby-gate {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--hw);
  background: repeating-linear-gradient(90deg, transparent 0 calc(var(--hw) - 0.6vw), #d6d3d1 calc(var(--hw) - 0.6vw) var(--hw));
  transform-origin: top;
  transition: transform 0.5s ease-in, opacity 0.5s;
  z-index: 3;
  pointer-events: none;
}
.derby-gate.is-open {
  transform: scaleY(0);
  opacity: 0;
}

.derby-runner {
  position: absolute;
  bottom: 2%;
  height: 120%;
  width: var(--hw);
  left: calc(var(--hw) + var(--p) * (100% - var(--hw) - var(--encl)));
  transform: translateX(-100%);
  transition: left 2.6s cubic-bezier(0.3, 0.7, 0.3, 1), transform 1.8s ease-out;
  z-index: 4;
}
.derby-runner .horse {
  position: absolute;
  bottom: 0;
  width: 100%;
  filter: drop-shadow(0 0.3vh 0.2vh rgba(0, 0, 0, 0.25));
}
.derby-runner.is-entering {
  transform: translateX(-260%);
  transition: none;
}
.derby-runner.is-home {
  left: calc(100% - 0.4vw);
}

.derby-float {
  position: absolute;
  top: -10%;
  left: 55%;
  font-weight: 900;
  font-size: min(calc(var(--lane-h) * 0.42), 3vh);
  color: #fff;
  text-shadow: 0 0.2vh 0.6vh rgba(0, 0, 0, 0.6);
  animation: derby-float 2.6s ease-out forwards;
  white-space: nowrap;
  z-index: 6;
}
.derby-float.is-big {
  color: var(--gold-hi);
  font-size: min(calc(var(--lane-h) * 0.6), 4.2vh);
}
.derby-float.is-big::after {
  content: " ⚡";
}

.derby-pop {
  position: absolute;
  top: -55%;
  left: 15%;
  width: calc(var(--lane-h) * 0.95);
  animation: derby-pop 3.4s ease-out forwards;
  z-index: 7;
}
.derby-pop svg {
  width: 100%;
  height: auto;
  filter: drop-shadow(0 0.4vh 0.6vh rgba(0, 0, 0, 0.45));
}

.derby-rosette {
  position: absolute;
  right: -12%;
  top: 0;
  display: grid;
  place-items: center;
  width: calc(var(--lane-h) * 0.62);
  height: calc(var(--lane-h) * 0.62);
  border-radius: 50%;
  background: radial-gradient(circle, var(--gold-hi) 0 55%, #b45309 56% 64%, var(--gold-hi) 65%);
  color: #422006;
  font-weight: 900;
  font-size: calc(var(--lane-h) * 0.3);
  box-shadow: 0 0.3vh 0.6vh rgba(0, 0, 0, 0.4);
  animation: derby-rosette 0.8s cubic-bezier(0.3, 1.6, 0.5, 1);
  z-index: 6;
}

.derby-lane.is-ghost .derby-runner .horse {
  opacity: 0.92;
}

/* --- The side: standings, join, ticker --------------------------------------------------------- */

.derby-side {
  display: flex;
  flex-direction: column;
  gap: 1.2vh;
  padding: 1.4vh 1vw;
  background: #082a20;
  border-left: 0.4vh solid var(--gold);
  min-height: 0;
}

.derby-kicker {
  margin: 0 0 0.8vh;
  font-size: 1.5vh;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--gold);
}

.derby-join {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.6vh 1vw;
  border-radius: 1.6vh;
  background: var(--cream);
  color: #0b3d2e;
}
.derby-join .derby-kicker {
  color: #0b3d2e;
  font-size: 2.2vh;
}
.derby-qr {
  width: min(19vw, 36vh);
  aspect-ratio: 1;
}
.derby-qr svg {
  width: 100%;
  height: 100%;
  display: block;
}
.derby-join-url {
  margin: 1vh 0 0;
  font-size: 2vh;
  font-weight: 700;
}
.derby-code {
  margin: 0.4vh 0 0;
  font-size: 5.4vh;
  font-weight: 900;
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
}
.derby-count {
  margin: 0.6vh 0 0;
  font-size: 1.8vh;
  color: #3f6b58;
}

.derby-standings {
  flex: 0 1 auto;
  min-height: 0;
  overflow: hidden;
}
.derby-standings-list {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
}
.derby-standings-list li {
  display: grid;
  grid-template-columns: 2.6vw 0.5vw 1fr auto;
  align-items: center;
  gap: 0.5vw;
  padding: 0.35vh 0.4vw;
  border-radius: 0.8vh;
  font-size: min(2vh, calc(48vh / var(--n)));
}
.derby-standings-list li.is-top {
  background: rgba(233, 185, 73, 0.14);
}
.derby-rank {
  font-weight: 900;
  text-align: center;
  font-size: 1.15em;
}
.derby-swatch {
  width: 0.5vw;
  height: 1.6em;
  border-radius: 0.3vw;
}
.derby-standing-names {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.1;
}
.derby-standing-names strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.derby-standing-names small {
  font-size: 0.72em;
  color: #9fc4b1;
}
.derby-xp {
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.derby-xp small {
  font-size: 0.6em;
  margin-left: 0.15em;
  color: #9fc4b1;
}

.standing-move {
  transition: transform 0.8s cubic-bezier(0.3, 0.8, 0.3, 1);
}

.derby-ticker {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 1.2vh 0.8vw;
  border-radius: 1.4vh;
  background: rgba(255, 255, 255, 0.06);
  border: 0.15vh solid rgba(255, 255, 255, 0.1);
}
.derby-ticker ul {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.7vh;
}
.derby-ticker li {
  font-size: 1.75vh;
  line-height: 1.3;
  color: #e6f2ea;
}
.derby-ticker li:first-child {
  font-weight: 700;
  color: #fff;
}
.derby-ticker li.is-big {
  color: var(--gold-hi);
}
.derby-ticker li.is-pass {
  color: #fdba74;
}
.derby-ticker li.is-oops {
  color: #fca5a5;
}
.derby-ticker.is-final {
  border-color: #f87171;
  background: rgba(185, 28, 28, 0.18);
}
.derby-ticker.is-final li:first-child {
  animation: derby-pulse 0.8s ease-in-out 3;
}
.tick-enter-active {
  transition: transform 0.5s cubic-bezier(0.3, 1.3, 0.5, 1), opacity 0.5s;
}
.tick-enter-from {
  transform: translateX(30%);
  opacity: 0;
}
.tick-leave-active {
  display: none;
}
.tick-move {
  transition: transform 0.4s ease;
}

/* --- Overlays -------------------------------------------------------------------------------- */

.derby-countdown {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(4, 30, 22, 0.45);
  pointer-events: none;
  z-index: 20;
}
.derby-countdown span {
  font-size: 40vh;
  font-weight: 900;
  color: #fff;
  text-shadow: 0 2vh 6vh rgba(0, 0, 0, 0.6), 0 0 4vh var(--gold);
  animation: derby-count 1s ease-out;
}

.derby-banner {
  position: fixed;
  left: 50%;
  top: 44%;
  transform: translate(-50%, -50%);
  padding: 2.4vh 4vw;
  border-radius: 2vh;
  background: var(--gold);
  color: #3b2506;
  font-size: 8vh;
  font-weight: 900;
  letter-spacing: 0.04em;
  white-space: nowrap;
  box-shadow: 0 2vh 6vh rgba(0, 0, 0, 0.5);
  animation: derby-banner 2.2s ease-in-out forwards;
  z-index: 21;
  pointer-events: none;
}

.derby-flash {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: #fff;
  animation: derby-flash 1.4s ease-out forwards;
  z-index: 22;
  pointer-events: none;
}
.derby-flash span {
  font-size: 9vh;
  font-weight: 900;
  color: #111;
}

.derby-sound {
  position: fixed;
  left: 50%;
  top: 2vh;
  transform: translateX(-50%);
  padding: 1vh 1.2vw;
  border: 0;
  border-radius: 99px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 1.7vh;
  font-weight: 700;
  cursor: pointer;
  z-index: 30;
}

.derby-podium {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5vh 4vw 3vh;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(252, 211, 77, 0.28), transparent 60%),
    linear-gradient(180deg, #0b1d17, #062218);
  z-index: 25;
  animation: derby-fade 1s ease-out;
}
.derby-podium h2 {
  margin: 0 0 2vh;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 5vh;
  color: var(--gold-hi);
}
.derby-podium-stage {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 24vw));
  grid-template-areas: "second first third";
  align-items: end;
  gap: 1.6vw;
  min-height: 0;
}
.derby-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  opacity: 0;
  transform: translateY(6vh) scale(0.94);
  transition: opacity 0.8s, transform 0.8s cubic-bezier(0.3, 1.4, 0.5, 1);
}
.derby-step.is-shown {
  opacity: 1;
  transform: none;
}
.derby-step.place-1 { grid-area: first; }
.derby-step.place-2 { grid-area: second; }
.derby-step.place-3 { grid-area: third; }
.derby-step-horse {
  width: 18vw;
}
.place-1 .derby-step-horse {
  width: 22vw;
}
.derby-step-name {
  margin: 1vh 0 0;
  display: flex;
  flex-direction: column;
}
.derby-step-name strong {
  font-size: 3.4vh;
}
.derby-step-name span {
  font-size: 2.2vh;
  color: #b8d8c6;
}
.derby-step-score {
  margin: 0.5vh 0 1.2vh;
  font-size: 2.2vh;
  font-weight: 700;
  color: var(--gold-hi);
}
.derby-step-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 1.2vh 1.2vh 0 0;
  background: linear-gradient(180deg, #f4f1e8, #cfc8b4);
  color: #3b2506;
  font-size: 4.4vh;
  font-weight: 900;
}
.derby-step-block span {
  font-size: 6vh;
}
.place-1 .derby-step-block { height: 26vh; background: linear-gradient(180deg, #fde68a, #e9b949); }
.place-2 .derby-step-block { height: 19vh; }
.place-3 .derby-step-block { height: 14vh; background: linear-gradient(180deg, #f5d0a9, #c98a4b); }

.derby-also {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6vh 1.6vw;
  margin: 2vh 0 0;
  padding: 0;
  list-style: none;
  font-size: 1.9vh;
  animation: derby-fade 1s ease-out;
}
.derby-also span {
  font-weight: 800;
  color: var(--gold);
}
.derby-also small {
  color: #9fc4b1;
}

@keyframes derby-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@keyframes derby-float {
  0% { transform: translateY(0) scale(0.6); opacity: 0; }
  15% { transform: translateY(-20%) scale(1.15); opacity: 1; }
  100% { transform: translateY(-160%) scale(1); opacity: 0; }
}
@keyframes derby-pop {
  0% { transform: translateY(40%) scale(0.2) rotate(-20deg); opacity: 0; }
  15% { transform: translateY(0) scale(1.15) rotate(6deg); opacity: 1; }
  25% { transform: scale(1) rotate(0); }
  85% { opacity: 1; }
  100% { transform: translateY(-50%) scale(0.8); opacity: 0; }
}
@keyframes derby-rosette {
  from { transform: scale(0) rotate(-180deg); }
  to { transform: scale(1) rotate(0); }
}
@keyframes derby-count {
  0% { transform: scale(1.8); opacity: 0; }
  30% { transform: scale(1); opacity: 1; }
  100% { transform: scale(0.85); opacity: 0.6; }
}
@keyframes derby-banner {
  0% { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
  15% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
  25%, 80% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1.1); opacity: 0; }
}
@keyframes derby-flash {
  0% { opacity: 0.95; }
  40% { opacity: 0.85; }
  100% { opacity: 0; }
}
@keyframes derby-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
