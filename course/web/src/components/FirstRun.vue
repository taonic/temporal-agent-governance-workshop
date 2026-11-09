<script setup>
// The map for a learner who hasn't finished a module yet: one calm column with one thing to do.
// Where to start (the tier their first step is in, as a trail), that step's card with Start,
// and where it all leads, as a row of chips. No toolbar, legend or stats: "Show the whole map"
// (or a chip, for that branch's way there) opens the full page, which takes over for good once
// the first module is done.
import { computed, ref } from "vue";

import NodeDetail from "./NodeDetail.vue";
import NodeTrail from "./NodeTrail.vue";
import { branchesById, modulesById, recommended, trunk, trunkTail } from "../progress.js";
import { course } from "../store.js";

const emit = defineEmits(["everything", "branch"]);

const first = computed(() => recommended.value ?? modulesById.get(trunk.modules[0]));
const branch = computed(() => branchesById.get(first.value.branch));
const tier = computed(() => branch.value.modules.map((id) => modulesById.get(id)).filter((m) => m.tier === first.value.tier && m.kind !== "boss"));
const minutes = computed(() => tier.value.reduce((sum, m) => sum + m.minutes, 0));
const roman = (n) => ["", "I", "II", "III", "IV", "V"][n] ?? String(n);

const picked = ref(null);
const selected = computed(() => picked.value ?? first.value.id);
const nudge = ref(0);
function select(id) {
  picked.value = id;
  nudge.value++;
}

const specializations = course.branches.filter((b) => b.id !== trunk.id);
const tail = modulesById.get(trunkTail);
</script>

<template>
  <section :class="['first-run', `branch-${branch.color}`]" aria-labelledby="first-run-title">
    <header class="first-run-head">
      <p class="eyebrow">Temporal Quest</p>
      <h1 id="first-run-title">Your quest starts here</h1>
      <p class="first-run-sub">
        <span aria-hidden="true">{{ branch.icon }}</span> {{ branch.name }} · Tier {{ roman(first.tier) }} · {{ branch.tiers[first.tier - 1].name }}:
        {{ tier.length }} short steps, about {{ minutes }} minutes.
      </p>
    </header>

    <NodeTrail class="first-run-trail" :modules="tier" :selected="selected" @select="select" />

    <div class="map-panel map-detail first-run-card">
      <NodeDetail :id="selected" :nudge="nudge" @select="select" />
    </div>

    <footer class="first-run-leads">
      <p>
        <strong>Where it leads.</strong> After {{ tail.id }}, five specializations open; skip ahead to any of them if you like.
        <button type="button" class="first-run-everything" @click="emit('everything')">Show the whole map <span aria-hidden="true">→</span></button>
      </p>
      <ul>
        <li v-for="b in specializations" :key="b.id">
          <button type="button" :class="['first-run-chip', `branch-${b.color}`]" @click="emit('branch', b.id)">
            <span aria-hidden="true">{{ b.icon }}</span>{{ b.name }}
          </button>
        </li>
      </ul>
    </footer>
  </section>
</template>
