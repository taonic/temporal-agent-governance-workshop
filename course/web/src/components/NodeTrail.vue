<script setup>
// A run of nodes as a trail, left to right, each named: its glyph, its number and minutes, its
// title. A click selects it. The focus view draws Fundamentals' first tier with it, and a
// specialization's tiers when its card expands.
import NodeGlyph from "./NodeGlyph.vue";
import { STATE_LABEL, activePath, branchesById, isDone, isPlayable, stateOf } from "../progress.js";
import { computed } from "vue";

const props = defineProps({
  modules: { type: Array, required: true },
  selected: { type: String, default: null },
  // Columns to lay out (at least as many as there are steps), so trails of different lengths line up.
  columns: { type: Number, default: 0 },
});
const emit = defineEmits(["select"]);

const pathIndex = computed(() => new Map((activePath.value?.modules ?? []).map((id, i) => [id, i + 1])));
const kindLabel = (m) => (m.kind === "boss" ? "Boss" : m.kind === "challenge" ? "Challenge" : m.id);
</script>

<template>
  <ol class="focus-trail" :style="{ '--steps': Math.max(columns, modules.length) }">
    <li v-for="m in modules" :key="m.id" :class="[`branch-${branchesById.get(m.branch).color}`, { 'is-lit': isDone(m.id) }]">
      <button
        type="button"
        :class="['focus-node', `is-${stateOf(m)}`, { 'is-selected': selected === m.id }]"
        :data-module="m.id"
        :data-exercise="m.exercise || null"
        :aria-pressed="selected === m.id"
        :aria-label="`${kindLabel(m)}: ${m.title}. ${STATE_LABEL[stateOf(m)]}${isPlayable(m) ? '' : ', coming soon'}`"
        @click="emit('select', m.id)"
      >
        <span class="focus-node-glyph">
          <NodeGlyph :kind="m.kind" :state="stateOf(m)" :label="m.id" :soon="!isPlayable(m)" :size="m.kind === 'boss' ? 48 : 44" halo />
          <span v-if="pathIndex.has(m.id)" class="path-badge">{{ pathIndex.get(m.id) }}</span>
        </span>
        <span class="focus-node-id">
          <span :class="['node-num', { 'is-kind': m.kind !== 'module' }]">{{ kindLabel(m) }}</span>
          <span class="focus-node-min">{{ m.minutes }} min</span>
        </span>
        <span class="focus-node-title">{{ m.title }}</span>
      </button>
    </li>
  </ol>
</template>
