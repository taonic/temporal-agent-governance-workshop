<script setup>
// What a node of the skill tree is, answering the four questions a learner has before they go in:
// what will I learn, what will I do, how long will it take, and what must I do first. Then the one
// thing to do about it: Start, or (when it's locked) the first step toward it, with skipping
// ahead offered as the rule says (recommended, not required).
import { computed, onBeforeUnmount, ref, watch } from "vue";

import NodeGlyph from "./NodeGlyph.vue";
import {
  STATE_LABEL,
  branchesById,
  firstStepTo,
  gatesOf,
  isPlayable,
  missingFor,
  moduleHref,
  modulesById,
  recommended,
  stateOf,
  stepsBefore,
} from "../progress.js";

const props = defineProps({
  id: { type: String, default: null },
  // The panel's heading level, and whether it offers the way back to the next step.
  compact: { type: Boolean, default: false },
  // Bumped when a node is clicked on the map: the call to action glows, to say where to go next.
  nudge: { type: Number, default: 0 },
});
const emit = defineEmits(["select"]);

const m = computed(() => (props.id ? modulesById.get(props.id) : null));
const branch = computed(() => branchesById.get(m.value.branch));
const state = computed(() => stateOf(m.value));
const soon = computed(() => !isPlayable(m.value));
const roman = (n) => ["", "I", "II", "III", "IV", "V"][n] ?? String(n);

const where = computed(() => {
  const mod = m.value;
  if (mod.kind === "boss") return "Boss";
  if (mod.kind === "challenge") return `Challenge after ${mod.after}`;
  return `Tier ${roman(mod.tier)} · ${branch.value.tiers[mod.tier - 1]?.name ?? ""}`;
});

const howLong = computed(() => {
  const mod = m.value;
  if (mod.kind === "boss") return `About ${mod.minutes} min, a quiz`;
  if (mod.kind === "challenge") return `About ${mod.minutes} min, ${mod.choices} choices to run`;
  return `About ${mod.minutes} min`;
});
const xpText = computed(() => (m.value.kind === "challenge" ? `up to ${m.value.xp} XP` : `+${m.value.xp} XP`));

// What it builds on: each prerequisite, done or not, and how many more are behind the missing ones.
const before = computed(() => {
  const mod = m.value;
  const direct = [...mod.requires, ...gatesOf(mod.id)].map((id) => modulesById.get(id));
  const missing = missingFor(mod);
  const more = Math.max(0, stepsBefore(mod).length - missing.length);
  return { direct, missing, more };
});
const firstStep = computed(() => (state.value === "locked" ? firstStepTo(m.value) : null));
const isNext = computed(() => recommended.value?.id === m.value?.id);

const glowing = ref(false);
let glowTimer = 0;
watch(
  () => props.nudge,
  () => {
    // Off, then on in the next frame, so a second click restarts the glow.
    glowing.value = false;
    clearTimeout(glowTimer);
    requestAnimationFrame(() => {
      glowing.value = true;
      glowTimer = setTimeout(() => (glowing.value = false), 2000);
    });
  },
);
onBeforeUnmount(() => clearTimeout(glowTimer));
</script>

<template>
  <section v-if="m" :class="['node-detail', `branch-${branch.color}`, `is-${state}`]" aria-live="polite" :aria-label="`${m.id}: ${m.title}`">
    <p class="node-detail-where"><span aria-hidden="true">{{ branch.icon }}</span> {{ branch.name }} · {{ where }}</p>
    <div class="node-detail-head">
      <NodeGlyph :kind="m.kind" :state="state" :label="m.id" :color="branch.color" :soon="soon" :size="40" />
      <div>
        <p class="node-detail-tags">
          <span :class="['node-num', 'node-detail-id', { 'is-kind': m.kind !== 'module' }]">{{ m.kind === "boss" ? "Boss" : m.kind === "challenge" ? "Challenge" : m.id }}</span>
          <span :class="['state-tag', `is-${state}`]">{{ STATE_LABEL[state] }}</span>
          <span v-if="soon" class="state-tag is-soon">Coming soon</span>
        </p>
        <h2 class="node-detail-title">{{ m.title }}</h2>
      </div>
    </div>

    <dl class="node-detail-facts">
      <div>
        <dt>{{ m.kind === "boss" ? "What it tests" : "What you'll learn" }}</dt>
        <dd>{{ m.learn }}</dd>
      </div>
      <div>
        <dt>What you'll do</dt>
        <dd>{{ m.teaser }}</dd>
      </div>
      <div>
        <dt>How long</dt>
        <dd>{{ howLong }} <span class="node-detail-xp">· {{ xpText }}</span></dd>
      </div>
      <div>
        <dt>Do first</dt>
        <dd v-if="!before.direct.length">Nothing. You can start here.</dd>
        <dd v-else>
          <ul class="node-detail-needs">
            <li v-for="r in before.direct" :key="r.id">
              <button type="button" class="node-detail-need" @click="emit('select', r.id)">
                <NodeGlyph :kind="r.kind" :state="stateOf(r)" :label="r.id" :color="branchesById.get(r.branch).color" :soon="!isPlayable(r)" :size="18" />
                <span><span class="node-num">{{ r.id }}</span> {{ r.title }}</span>
                <span class="node-detail-need-state">{{ stateOf(r) === "done" ? "Done" : "Not yet" }}</span>
              </button>
            </li>
          </ul>
          <p v-if="before.more" class="node-detail-more">and {{ before.more }} {{ before.more === 1 ? "step" : "steps" }} before {{ before.missing.length === 1 ? "it" : "them" }}</p>
        </dd>
      </div>
    </dl>

    <div class="node-detail-actions">
      <template v-if="soon">
        <p class="node-detail-rule">Coming soon: it's on the map so you can plan ahead, but you can't play it yet.</p>
      </template>
      <template v-else-if="state === 'locked'">
        <a v-if="firstStep" :class="['button', 'button-primary', 'node-detail-go', { 'is-glowing': glowing }]" :href="moduleHref(firstStep.id)">
          <svg class="node-detail-play" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg> Start with {{ firstStep.id }} <span class="node-detail-go-what">{{ firstStep.title }}</span>
        </a>
        <p class="node-detail-rule">
          Doing {{ before.missing.map((r) => r.id).join(" and ") }} first is recommended, not required.
          <a :href="moduleHref(m.id)">Skip ahead to {{ m.id }}</a> and we fill in the code it builds on for you.
        </p>
      </template>
      <a v-else-if="state === 'done'" :class="['button', 'button-secondary', 'node-detail-go', { 'is-glowing': glowing }]" :href="moduleHref(m.id)">
        Do {{ m.id }} again <span aria-hidden="true">→</span>
      </a>
      <a v-else :class="['button', 'button-primary', 'node-detail-go', { 'is-glowing': glowing }]" :href="moduleHref(m.id)">
        <svg class="node-detail-play" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg> Start {{ m.id }} <span class="node-detail-go-what">{{ m.title }}</span>
      </a>
      <button v-if="!compact && !isNext && recommended" type="button" class="node-detail-back" @click="emit('select', recommended.id)">
        ← Back to your next step: {{ recommended.id }} {{ recommended.title }}
      </button>
    </div>
  </section>
  <section v-else class="node-detail">
    <p class="node-detail-where">Every playable module done</p>
    <h2 class="node-detail-title">You've cleared the map, for now.</h2>
    <p class="node-detail-rule">The nodes marked Coming soon arrive as their content does.</p>
  </section>
</template>
