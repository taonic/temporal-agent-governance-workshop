<script setup>
// A badge, drawn (badgeArt.js): earned in its colours, or locked, greyed. Below 48px it's its
// shape and icon only.
import { computed } from "vue";

import { medalSvg } from "../badgeArt.js";

const props = defineProps({
  badge: { type: Object, required: true },
  earned: { type: Boolean, default: false },
  size: { type: Number, default: 96 },
  // Read out to screen readers; without one the medal is decoration beside its name.
  label: { type: String, default: null },
});
const svg = computed(() => medalSvg(props.badge, { earned: props.earned, size: props.size, label: props.label }));
</script>

<template>
  <span class="badge-medal-wrap" :style="{ width: `${size}px` }" v-html="svg" />
</template>
