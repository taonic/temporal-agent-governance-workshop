<script setup>
// Your class title (its boss badge), level and XP, in the top bar: a link to your badges.
// Earning XP floats "+10 XP" off it, and a new level gets confetti.
import { ref, watch } from "vue";

import BadgeMedal from "./BadgeMedal.vue";
import { launchConfetti } from "../confetti.js";
import { LEVEL_XP, level, levelXp, moduleName, modulesById, progress, title, titleBadge, xp } from "../progress.js";
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
      toast(`Level ${gain.levelUp}! ${moduleName(m)} done`, 3600);
      try {
        if (!progress.lastBadges || progress.lastBadges.at < gain.at) launchConfetti();
      } catch {
        /* best effort */
      }
    } else {
      toast(`${moduleName(m)} done: +${gain.amount} XP`, 2600);
    }
  },
);
</script>

<template>
  <a class="xp-pill" :class="{ 'is-bumped': bump }" href="#/badges" :title="`${title} · Level ${level} · ${xp} XP: your badges`" @animationend="bump = false">
    <span class="xp-pill-title">
      <BadgeMedal v-if="titleBadge" :badge="titleBadge" earned :size="22" />
      <span class="xp-pill-title-text">{{ title }}</span>
    </span>
    <span class="xp-pill-level">Lv {{ level }}</span>
    <span class="xp-bar xp-pill-bar" aria-hidden="true"><span :style="{ width: `${(levelXp / LEVEL_XP) * 100}%` }" /></span>
    <span class="xp-pill-xp">{{ xp }} XP</span>
    <span v-for="g in gains" :key="g.key" class="xp-gain" aria-hidden="true">{{ g.text }}</span>
  </a>
</template>
