<script setup>
// Your level and XP, in the top bar: a link to the map. Earning XP floats "+10 XP" off it, and
// a new level gets confetti.
import { ref, watch } from "vue";

import { launchConfetti } from "../confetti.js";
import { LEVEL_XP, level, levelXp, modulesById, progress, xp } from "../progress.js";
import { toast } from "../store.js";

const gains = ref([]);
const bump = ref(false);

watch(
  () => progress.lastGain,
  (gain) => {
    if (!gain) return;
    const key = gain.at;
    gains.value = [...gains.value, { key, text: `+${gain.amount} XP` }];
    setTimeout(() => (gains.value = gains.value.filter((g) => g.key !== key)), 1600);
    bump.value = false;
    requestAnimationFrame(() => (bump.value = true));
    const m = modulesById.get(gain.id);
    if (gain.levelUp) {
      toast(`Level ${gain.levelUp}! ${m.id} · ${m.title} done`, 3600);
      try {
        launchConfetti();
      } catch {
        /* best effort */
      }
    } else {
      toast(`${m.id} · ${m.title} done: +${gain.amount} XP`, 2600);
    }
  },
);
</script>

<template>
  <a class="xp-pill" :class="{ 'is-bumped': bump }" href="#/" :title="`Level ${level} · ${xp} XP: open the skill tree`" @animationend="bump = false">
    <span class="xp-pill-level">Lv {{ level }}</span>
    <span class="xp-bar xp-pill-bar" aria-hidden="true"><span :style="{ width: `${(levelXp / LEVEL_XP) * 100}%` }" /></span>
    <span class="xp-pill-xp">{{ xp }} XP</span>
    <span v-for="g in gains" :key="g.key" class="xp-gain" aria-hidden="true">{{ g.text }}</span>
  </a>
</template>
