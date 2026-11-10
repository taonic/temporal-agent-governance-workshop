<script setup>
// The map, focused: the tier the learner's next step is in, as a trail, every node named
// (Fundamentals' first tier, to begin with: "Start here"), what comes after it, then the
// specializations as destinations to plan with. A specialization's card expands
// its map in place: what comes before it, then its own tiers as trails, its boss at the end. The
// full map is one click away.
import { computed, nextTick, ref, watch } from "vue";

import BadgeMedal from "./BadgeMedal.vue";
import NodeTrail from "./NodeTrail.vue";
import { course } from "../store.js";
import { badges, branchesById, isDone, isEarned, isPlayable, mapOrder, modulesById, opensAfter, recommended, routeTo, trunk, trunkTail } from "../progress.js";

const props = defineProps({ selected: { type: String, default: null } });
const emit = defineEmits(["select", "expand", "branch"]);

// A tier of a branch, as the trail draws it: its modules (the boss with the last tier), what
// comes after it, and how far along it is.
function tierOf(branch, n) {
  const tiers = branch.tiers.map((_, i) => branch.modules.map((id) => modulesById.get(id)).filter((m) => m.tier === i + 1));
  const modules = [...tiers[n - 1], ...(n === tiers.length && branch.boss ? [modulesById.get(branch.boss)] : [])];
  const after = tiers[n]?.filter((m) => m.kind === "module") ?? [];
  return {
    key: `${branch.id}:${n}`,
    branch,
    n,
    name: branch.tiers[n - 1].name,
    modules,
    start: branch.id === trunk.id && n === 1,
    minutes: modules.reduce((sum, m) => sum + m.minutes, 0),
    // Progress over what can be played (a boss that's coming soon doesn't hold a tier back).
    total: modules.filter(isPlayable).length,
    done: modules.filter((m) => isPlayable(m) && isDone(m.id)).length,
    after: after.length ? { n: n + 1, name: branch.tiers[n].name, modules: after } : null,
  };
}
const tierKey = (m) => `${m.branch}:${m.kind === "boss" ? branchesById.get(m.branch).tiers.length : m.tier}`;

// Where the learner is: the tier their next step is in. With nothing left to play, Fundamentals'
// first tier.
const here = computed(() => {
  const next = recommended.value;
  if (!next) return tierOf(trunk, 1);
  const branch = branchesById.get(next.branch);
  return tierOf(branch, next.kind === "boss" ? branch.tiers.length : next.tier);
});
// The tiers to switch between: Fundamentals', then (once there) the specialization's.
const tabs = computed(() => {
  const branches = here.value.branch.id === trunk.id ? [trunk] : [trunk, here.value.branch];
  return branches.flatMap((b) => b.tiers.map((_, i) => tierOf(b, i + 1)));
});
// The tier on show: where the learner is, unless they picked another (or a node in another).
const picked = ref(null);
const shown = computed(() => tabs.value.find((t) => t.key === picked.value) ?? here.value);
watch(
  () => props.selected,
  (id) => {
    const m = id && modulesById.get(id);
    if (m && tabs.value.some((t) => t.key === tierKey(m))) picked.value = tierKey(m);
  },
);
watch(() => here.value.key, () => (picked.value = null));
const tail = modulesById.get(trunkTail);

const branches = computed(() =>
  course.branches
    .filter((b) => b.column)
    .sort((a, b) => a.column - b.column)
    .map((b) => {
      const mods = b.modules.map((id) => modulesById.get(id));
      const playable = mods.filter(isPlayable).length;
      return { ...b, count: mods.length, playable, done: mods.filter((m) => isDone(m.id)).length, after: opensAfter(b), first: mods[0] };
    }),
);

// The card that's expanded, and its map: the way there from other branches, then its tiers.
const open = ref(null);
const expanded = ref(null);
const openBranch = computed(() => (open.value ? branches.value.find((b) => b.id === open.value) : null));
const openMap = computed(() => {
  const b = openBranch.value;
  if (!b) return null;
  const route = routeTo(b);
  const before = course.branches
    .filter((other) => other.id !== b.id)
    .map((other) => {
      const steps = mapOrder.filter((id) => route.has(id) && modulesById.get(id).branch === other.id).map((id) => modulesById.get(id));
      return { branch: other, steps, done: steps.filter((m) => isDone(m.id)).length, first: steps.find((m) => !isDone(m.id)) ?? steps[0] };
    })
    .filter((g) => g.steps.length);
  const tiers = b.tiers
    .map((tier, i) => {
      const mods = b.modules.map((id) => modulesById.get(id)).filter((m) => m.tier === i + 1);
      return { name: tier.name, n: i + 1, modules: mods };
    })
    .filter((t) => t.modules.length);
  if (b.boss) tiers.at(-1).modules = [...tiers.at(-1).modules, modulesById.get(b.boss)];
  return { before, tiers, columns: Math.max(...tiers.map((t) => t.modules.length)) };
});
async function toggle(b) {
  open.value = open.value === b.id ? null : b.id;
  if (!open.value) return;
  emit("select", b.first.id);
  await nextTick();
  expanded.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
const roman = (n) => ["", "I", "II", "III", "IV", "V"][n] ?? String(n);
// The badge the tier on show earns, if it has one.
const shownBadge = computed(() => badges.find((b) => b.kind === "tier" && b.branch === shown.value.branch.id && b.tier === shown.value.n) ?? null);
</script>

<template>
  <section class="focus-map" aria-labelledby="focus-title">
    <header :class="['focus-head', `branch-${shown.branch.color}`]">
      <p class="focus-kicker"><span aria-hidden="true">{{ shown.branch.icon }}</span> {{ shown.branch.name }} · Tier {{ roman(shown.n) }} · {{ shown.name }}</p>
      <h2 id="focus-title">{{ shown.key !== here.key ? `Tier ${roman(shown.n)} · ${shown.name}` : shown.start ? "Start here" : "Where you are" }}</h2>
      <p class="focus-sub">
        {{ shown.modules.length }} short steps, about {{ shown.minutes }} minutes in all · {{ shown.done }} of {{ shown.total }} done
        <button v-if="shown.key !== here.key" type="button" class="focus-link" @click="picked = null">· Back to where you are</button>
      </p>
      <a v-if="shownBadge" class="focus-reward" href="#/badges" :data-badge="shownBadge.id">
        <BadgeMedal :badge="shownBadge" :earned="isEarned(shownBadge.id)" :size="44" />
        <span v-if="isEarned(shownBadge.id)">Earned <strong>{{ shownBadge.name }}</strong></span>
        <span v-else>Finish this tier to earn <strong>{{ shownBadge.name }}</strong></span>
      </a>
    </header>

    <div class="focus-tabs" role="tablist" aria-label="Tiers">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="t.key === shown.key"
        :class="['focus-tab', `branch-${t.branch.color}`, { 'is-active': t.key === shown.key, 'is-here': t.key === here.key, 'is-done': t.total && t.done === t.total }]"
        @click="picked = t.key"
      >
        <span v-if="t.branch.id !== trunk.id || tabs.some((o) => o.branch.id !== trunk.id)" aria-hidden="true">{{ t.branch.icon }}</span>
        <span class="focus-tab-name">Tier {{ roman(t.n) }} · {{ t.name }}</span>
        <span class="focus-tab-count">{{ t.total && t.done === t.total ? "✓" : `${t.done}/${t.total}` }}</span>
        <span v-if="t.key === here.key" class="focus-tab-here">You are here</span>
      </button>
    </div>

    <NodeTrail :modules="shown.modules" :selected="selected" @select="(id) => emit('select', id)" />

    <p v-if="shown.after" class="focus-then">
      <strong>Then, Tier {{ roman(shown.after.n) }} · {{ shown.after.name }}:</strong>
      <template v-if="shown.after.modules.length === 1">“{{ shown.after.modules[0].title }}”.</template>
      <template v-else>{{ shown.after.modules.length }} more modules, from “{{ shown.after.modules[0].title }}” to “{{ shown.after.modules.at(-1).title }}”.</template>
      <template v-if="shown.branch.id === trunk.id">Recommended, not required before a specialization.</template>
    </p>

    <div class="focus-leads">
      <h3>Where it leads</h3>
      <p>
        Five specializations open after <button type="button" class="focus-link" @click="emit('select', tail.id)">{{ tail.id }} · {{ tail.title }}</button>.
        Finishing Fundamentals first is recommended, not required: you can skip ahead to any of them.
      </p>
      <ul class="focus-branches">
        <li v-for="b in branches" :key="b.id">
          <button
            type="button"
            :class="['focus-branch', `branch-${b.color}`, { 'is-open': open === b.id }]"
            :aria-expanded="open === b.id"
            :aria-controls="`focus-expanded-${b.id}`"
            @click="toggle(b)"
          >
            <span class="focus-branch-top">
              <span class="focus-branch-icon" aria-hidden="true">{{ b.icon }}</span>
              <span :class="['state-tag', b.playable ? 'is-ready' : 'is-soon']">{{ b.playable ? `${b.count} modules` : "Coming soon" }}</span>
            </span>
            <span class="focus-branch-name">{{ b.name }}</span>
            <span class="focus-branch-desc">{{ b.description }}</span>
            <span class="focus-branch-after">
              Opens after
              <template v-for="(r, i) in b.after" :key="r.id">{{ i ? ", " : " " }}<strong :class="`branch-${branchesById.get(r.branch).color}`">{{ r.id }}</strong></template>
              <template v-if="b.done"> · {{ b.done }}/{{ b.count }} done</template>
            </span>
            <span class="focus-branch-go">{{ open === b.id ? "Hide its map" : "Show its map" }} <span aria-hidden="true">{{ open === b.id ? "↑" : "↓" }}</span></span>
          </button>
        </li>
      </ul>

      <!-- The expanded card: its map, in place. -->
      <section
        v-if="openBranch"
        :id="`focus-expanded-${openBranch.id}`"
        ref="expanded"
        :class="['focus-expanded', `branch-${openBranch.color}`]"
        :aria-label="`${openBranch.name}: its map`"
      >
        <header class="focus-expanded-head">
          <h4><span aria-hidden="true">{{ openBranch.icon }}</span> {{ openBranch.name }}</h4>
          <span class="focus-expanded-actions">
            <button type="button" class="button" @click="emit('branch', openBranch.id)">On the full map <span aria-hidden="true">→</span></button>
            <button type="button" class="button" aria-label="Collapse" @click="open = null">✕</button>
          </span>
        </header>
        <div class="focus-before">
          <span class="focus-before-label">Before it (recommended)</span>
          <template v-for="(g, i) in openMap.before" :key="g.branch.id">
            <span v-if="i" class="focus-before-arrow" aria-hidden="true">→</span>
            <button type="button" :class="['focus-before-step', `branch-${g.branch.color}`]" @click="emit('select', g.first.id)">
              <span aria-hidden="true">{{ g.branch.icon }}</span>
              {{ g.branch.name }}
              <span class="node-num">{{ g.steps[0].id }}</span>→<span class="node-num">{{ g.steps.at(-1).id }}</span>
              <span class="focus-before-count">{{ g.done }}/{{ g.steps.length }} done</span>
            </button>
          </template>
        </div>
        <div v-for="tier in openMap.tiers" :key="tier.n" class="focus-expanded-tier">
          <p class="focus-expanded-tier-name">Tier {{ roman(tier.n) }} · {{ tier.name }}</p>
          <NodeTrail :modules="tier.modules" :columns="openMap.columns" :selected="selected" @select="(id) => emit('select', id)" />
        </div>
        <p v-if="!openBranch.playable" class="focus-expanded-soon">Coming soon: on the map so you can plan ahead, not playable yet.</p>
      </section>
    </div>

    <button type="button" class="button button-secondary focus-expand" @click="emit('expand')">
      Show the full map <span aria-hidden="true">↓</span>
    </button>
  </section>
</template>
