<script setup>
// The earn moment: one card for every badge earned at once, with confetti. A boss badge is its
// centre (the class title, unlocked), with the rest beside it; otherwise the first badge is.
// Nothing queues: badges earned together share the card, and a later one replaces it.
// It closes with ×, Keep going, Esc (wherever the focus is), a click outside it, or a new page.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import BadgeMedal from "./BadgeMedal.vue";
import { launchConfetti } from "../confetti.js";
import { badgesById, branchesById, progress } from "../progress.js";
import { store } from "../store.js";

const shown = ref(null); // { ids, at }
const button = ref(null);
watch(
  () => progress.lastBadges,
  (moment) => {
    if (!moment?.ids?.length) return;
    shown.value = moment;
    nextTick(() => button.value?.focus());
    try {
      launchConfetti({ count: 140, duration: 3500 });
    } catch {
      /* best effort */
    }
  },
);

const earned = computed(() => (shown.value?.ids ?? []).map((id) => badgesById.get(id)).filter(Boolean));
const centre = computed(() => earned.value.find((b) => b.kind === "boss") ?? earned.value[0] ?? null);
const beside = computed(() => earned.value.filter((b) => b !== centre.value));
const kicker = computed(() => {
  const b = centre.value;
  if (!b) return "";
  if (b.kind === "boss") return `${branchesById.get(b.branch)?.name} boss beaten`;
  return earned.value.length > 1 ? `${earned.value.length} badges earned` : "Badge earned";
});
const close = () => (shown.value = null);
const onKey = (event) => event.key === "Escape" && shown.value && close();
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
watch(() => [store.route.page, store.route.module], close);
</script>

<template>
  <div v-if="centre" class="earn-backdrop" @click.self="close">
    <div class="earn-card" role="dialog" aria-modal="true" :aria-label="`${kicker}: ${centre.name}`">
      <button class="earn-close" type="button" aria-label="Close" title="Close (Esc)" @click="close">×</button>
      <p class="earn-kicker">{{ kicker }}</p>
      <div class="earn-stack">
        <BadgeMedal v-for="b in beside.slice(0, 1)" :key="b.id" :badge="b" earned :size="64" />
        <BadgeMedal class="earn-centre" :badge="centre" earned :size="132" />
        <BadgeMedal v-for="b in beside.slice(1, 3)" :key="b.id" :badge="b" earned :size="64" />
      </div>
      <h2 class="earn-name">{{ centre.name }}</h2>
      <p class="earn-sub">{{ centre.kind === "boss" ? "Your new class title" : centre.criteria }}</p>
      <p v-if="beside.length" class="earn-also">
        <span v-for="b in beside" :key="b.id">+ <strong>{{ b.name }}</strong></span>
      </p>
      <div class="earn-actions">
        <a class="button button-secondary" href="#/badges" @click="close">See your badges</a>
        <button ref="button" class="button button-primary" type="button" @click="close">Keep going</button>
      </div>
    </div>
  </div>
</template>
