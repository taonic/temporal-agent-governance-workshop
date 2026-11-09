<script setup>
// The front door: the skill tree. A rail with your level and the node you've selected (the next
// one, to begin with: what you'll learn and do, how long, what comes first, and Start); beside it
// the view (focused, or the full map), the path, the legend, and the map. On a phone, the same
// tree as a list, branch by branch, a tap opening a node's details in place.
//
// The rule, the same everywhere: prerequisites are recommended, not required. A locked node can
// be entered (skip ahead) and what it builds on is solved for you.
import { computed, nextTick, ref, watch } from "vue";

import FocusMap from "../components/FocusMap.vue";
import NodeDetail from "../components/NodeDetail.vue";
import NodeGlyph from "../components/NodeGlyph.vue";
import SkillMap from "../components/SkillMap.vue";
import { course, store } from "../store.js";
import {
  LEVEL_XP,
  STATE_LABEL,
  activePath,
  branchesById,
  isDone,
  isPlayable,
  level,
  levelXp,
  mapView,
  modulesById,
  opensAfter,
  progress,
  recommended,
  stateOf,
  title,
  xp,
} from "../progress.js";

const playable = computed(() => course.modules.filter((m) => m.kind === "module" && isPlayable(m)));
const challenges = computed(() => course.modules.filter((m) => m.kind === "challenge" && isPlayable(m)));
const bosses = computed(() => course.modules.filter((m) => m.kind === "boss"));
const doneCount = (list) => list.filter((m) => isDone(m.id)).length;
const pathModules = computed(() => (activePath.value?.modules ?? []).map((id) => modulesById.get(id)));
const pathDone = computed(() => doneCount(pathModules.value));

// The node the detail panel shows: one the learner picked, or one a link pointed at, or the next.
const picked = ref(store.route.focus ?? null);
watch(() => store.route.focus, (id) => id && (picked.value = id));
const selected = computed(() => picked.value ?? recommended.value?.id ?? null);
const detail = ref(null);
const nudge = ref(0);
function select(id) {
  picked.value = id;
  nudge.value++;
  // Narrower, the panel sits above the map: bring it into view.
  if (window.matchMedia?.("(max-width: 1100px)").matches) detail.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setPath(event) {
  progress.path = event.target.value || null;
}
function setView(view) {
  progress.mapView = view;
  if (view === "focus") toward.value = null;
}

// The specialization a focus card asked for: the full map, the way there lit, the rest stepped back.
const toward = ref(null);
const towardBranch = computed(() => (toward.value ? branchesById.get(toward.value) : null));
const towardEl = ref(null);
async function showBranch(id) {
  toward.value = id;
  picked.value = branchesById.get(id).modules[0];
  setView("full");
  await nextTick();
  towardEl.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function expand() {
  setView("full");
}

// On a phone: the row whose details are open, in place.
const opened = ref(null);
const roman = (n) => ["", "I", "II", "III", "IV", "V"][n] ?? String(n);
const tiersOf = (branch) =>
  branch.tiers.map((tier, i) => ({ ...tier, n: i + 1, modules: branch.modules.map((id) => modulesById.get(id)).filter((m) => m.tier === i + 1) }));
const listBranches = computed(() =>
  course.branches.map((b) => ({ ...b, after: opensAfter(b), hasNext: b.modules.some((id) => stateOf(modulesById.get(id)) === "next") })),
);
const LEGEND = [
  { state: "next", text: "Next: your next step" },
  { state: "open", text: "Available" },
  { state: "done", text: "Completed" },
  { state: "locked", text: "Locked: do what it builds on first, or skip ahead" },
];
</script>

<template>
  <main class="map-page">
    <div class="map-stage">
      <aside class="map-rail">
        <section class="map-panel map-player" aria-labelledby="map-title">
          <p class="eyebrow">Temporal Quest</p>
          <h1 id="map-title">Your skill tree</h1>
          <div class="map-level">
            <span class="map-level-badge" :aria-label="`Level ${level}`"><small>Lv</small>{{ level }}</span>
            <div class="map-level-body">
              <p class="map-level-title">{{ title }}</p>
              <div class="xp-bar" role="progressbar" :aria-valuenow="levelXp" aria-valuemin="0" :aria-valuemax="LEVEL_XP" :aria-label="`${levelXp} of ${LEVEL_XP} XP to level ${level + 1}`">
                <span :style="{ width: `${(levelXp / LEVEL_XP) * 100}%` }" />
              </div>
              <p class="map-level-meta">{{ xp }} XP · {{ LEVEL_XP - levelXp }} to level {{ level + 1 }}</p>
            </div>
          </div>
          <p class="map-stats">
            <span><strong>{{ doneCount(playable) }}</strong>/{{ playable.length }} modules</span>
            <span><strong>{{ doneCount(challenges) }}</strong>/{{ challenges.length }} challenges</span>
            <span><strong>{{ doneCount(bosses) }}</strong>/{{ bosses.length }} bosses</span>
          </p>
        </section>

        <!-- The selected node (the next one, to begin with). On a phone, always the next one. -->
        <div ref="detail" class="map-panel map-detail map-detail-selected">
          <NodeDetail :id="selected" :nudge="nudge" @select="(id) => (picked = id)" />
        </div>
        <div class="map-panel map-detail map-detail-next">
          <NodeDetail :id="recommended?.id ?? null" compact @select="(id) => (opened = id)" />
        </div>
      </aside>

      <section class="map-main" aria-label="The skill tree">
        <div class="map-toolbar">
          <div class="map-view-toggle" role="group" aria-label="View">
            <button type="button" :class="['button', mapView === 'focus' ? 'active' : '']" :aria-pressed="mapView === 'focus'" @click="setView('focus')">Focus</button>
            <button type="button" :class="['button', mapView === 'full' ? 'active' : '']" :aria-pressed="mapView === 'full'" @click="setView('full')">Full map</button>
          </div>
          <label class="map-path-pick">
            <span>Path</span>
            <select :value="progress.path ?? ''" @change="setPath">
              <option value="">None: your own order</option>
              <option v-for="p in course.paths" :key="p.id" :value="p.id">{{ p.title }}</option>
            </select>
          </label>
          <p class="map-path-progress">
            <template v-if="activePath">
              <span class="xp-bar is-path"><span :style="{ width: `${(pathDone / pathModules.length) * 100}%` }" /></span>
              {{ pathDone }}/{{ pathModules.length }} on this path. Next follows its numbers.
            </template>
            <template v-else>Following an event? Pick its path to number its route.</template>
          </p>
        </div>
        <ul class="map-legend" aria-label="Legend">
          <li v-for="item in LEGEND" :key="item.state"><NodeGlyph :state="item.state" label="F2" color="green" :size="22" />{{ item.text }}</li>
          <li><NodeGlyph state="open" label="P1" color="slate" soon :size="22" />Coming soon (not playable yet)</li>
        </ul>
        <p class="map-rule">
          <strong>Prerequisites are recommended, not required.</strong> Every node you can play can be entered:
          skip ahead, and we fill in the code it builds on for you.
        </p>

        <FocusMap v-if="mapView === 'focus'" class="map-desktop" :selected="selected" @select="select" @expand="expand" @branch="showBranch" />
        <template v-else>
          <p v-if="towardBranch" ref="towardEl" :class="['map-toward', `branch-${towardBranch.color}`]">
            <span><span aria-hidden="true">{{ towardBranch.icon }}</span> The way to <strong>{{ towardBranch.name }}</strong>: everything it builds on, from F1.</span>
            <button type="button" class="button" @click="toward = null">Show the whole tree</button>
          </p>
          <SkillMap class="map-desktop" :selected="selected" :toward="toward" @select="select" />
        </template>
      </section>
    </div>

    <!-- On a phone: the tree as a list. -->
    <div class="map-list" aria-label="The skill tree, branch by branch">
      <p class="map-rule">
        <strong>Prerequisites are recommended, not required.</strong> Skip ahead to any playable node, and we fill in what it builds on.
      </p>
      <details v-for="branch in listBranches" :key="branch.id" :class="['map-list-branch', `branch-${branch.color}`]" :open="branch.hasNext">
        <summary>
          <span class="map-list-icon" aria-hidden="true">{{ branch.icon }}</span>
          <span class="map-list-name">
            {{ branch.name }}
            <small v-if="branch.after.length">Opens after {{ branch.after.map((r) => r.id).join(", ") }}</small>
            <small v-else>Start here</small>
          </span>
          <span class="map-list-count">{{ doneCount(branch.modules.map((id) => modulesById.get(id))) }}/{{ branch.modules.length }}</span>
        </summary>
        <div v-for="tier in tiersOf(branch)" :key="tier.n" class="map-list-tier">
          <p class="map-list-tier-name">Tier {{ roman(tier.n) }} · {{ tier.name }}</p>
          <template v-for="m in [...tier.modules, ...(tier.n === branch.tiers.length && branch.boss ? [modulesById.get(branch.boss)] : [])]" :key="m.id">
            <button
              type="button"
              :class="['map-list-row', `is-${stateOf(m)}`, { 'is-soon': !isPlayable(m), 'is-opened': opened === m.id }]"
              :aria-expanded="opened === m.id"
              @click="opened = opened === m.id ? null : m.id"
            >
              <NodeGlyph :kind="m.kind" :state="stateOf(m)" :label="m.id" :soon="!isPlayable(m)" :size="26" />
              <span class="map-list-title"><span :class="['node-num', 'map-list-id', { 'is-kind': m.kind !== 'module' }]">{{ m.kind === "boss" ? "Boss" : m.kind === "challenge" ? "Challenge" : m.id }}</span>{{ m.title }}</span>
              <span class="map-list-state">{{ isPlayable(m) ? STATE_LABEL[stateOf(m)] : "Soon" }}</span>
            </button>
            <div v-if="opened === m.id" class="map-list-detail">
              <NodeDetail :id="m.id" compact @select="(id) => (opened = id)" />
            </div>
          </template>
        </div>
      </details>
    </div>
  </main>
</template>
