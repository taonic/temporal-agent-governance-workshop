<script setup>
// The map for a learner who hasn't finished a module yet: one calm column with one thing to do.
// Where to start (the tier their first step is in, as a trail), that step's card with Start,
// and where it all leads, as a row of chips. No toolbar, legend or stats: "Show the whole map"
// (or a chip, for that branch's way there) opens the full page, which takes over for good once
// the first module is done.
//
// A branch with a welcome (Essentials) gets a leaner screen still: its goal in two lines, the idea
// acted out (TripLoop), what they're starting and why it's a trip, and Let's begin. No way to
// the whole map: it opens once their first module is done (MapPage.vue).
import { computed, ref } from "vue";

import NodeDetail from "./NodeDetail.vue";
import NodeTrail from "./NodeTrail.vue";
import TripLoop from "./TripLoop.vue";
import { branchesById, moduleHref, modulesById, recommended, trunk, trunkTail } from "../progress.js";
import { course, store } from "../store.js";

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
// Who they're learning as, and the way to switch: there from the first visit, signed in or not.
const personaLabel = computed(() => course.personas.find((p) => p.id === store.persona.id)?.label ?? "");
</script>

<template>
  <section v-if="branch.welcome" :class="['first-run', 'first-run-lean', `branch-${branch.color}`]" aria-labelledby="first-run-title">
    <p class="map-persona first-run-persona">
      Learning as <strong>{{ personaLabel }}</strong>
      <button type="button" class="focus-link" @click="store.personaPicker = true">Switch</button>
    </p>
    <header class="first-run-head">
      <h1 id="first-run-title">{{ branch.welcome.title }}</h1>
      <p class="first-run-goal">{{ branch.welcome.goal }}</p>
    </header>

    <TripLoop />

    <dl v-if="branch.welcome.about?.length" class="first-run-about">
      <div v-for="a in branch.welcome.about" :key="a.title">
        <dt>{{ a.title }}</dt>
        <dd>{{ a.text }}</dd>
      </div>
    </dl>

    <div class="first-run-go">
      <a class="button button-primary first-run-start" :href="moduleHref(first.id)">Let's begin <span aria-hidden="true">→</span></a>
    </div>
  </section>

  <section v-else :class="['first-run', `branch-${branch.color}`]" aria-labelledby="first-run-title">
    <header class="first-run-head">
      <p class="eyebrow">Temporal Quest</p>
      <h1 id="first-run-title">Your quest starts here</h1>
      <p class="first-run-sub">
        <span aria-hidden="true">{{ branch.icon }}</span> {{ branch.name }} · Tier {{ roman(first.tier) }} · {{ branch.tiers[first.tier - 1].name }}:
        {{ tier.length }} short steps, about {{ minutes }} minutes.
      </p>
      <p class="map-persona first-run-persona">
        Learning as <strong>{{ personaLabel }}</strong>
        <button type="button" class="focus-link" @click="store.personaPicker = true">Switch</button>
      </p>
    </header>

    <NodeTrail class="first-run-trail" :modules="tier" :selected="selected" @select="select" />

    <div class="map-panel map-detail first-run-card">
      <NodeDetail :id="selected" :nudge="nudge" @select="select" />
    </div>

    <footer class="first-run-leads">
      <p v-if="specializations.length">
        <strong>Where it leads.</strong> After {{ tail.id }}, {{ specializations.length }} specializations open; skip ahead to any of them if you like.
        <button type="button" class="first-run-everything" @click="emit('everything')">Show the whole map <span aria-hidden="true">→</span></button>
      </p>
      <p v-else>
        <button type="button" class="first-run-everything" @click="emit('everything')">Show the whole map <span aria-hidden="true">→</span></button>
      </p>
      <ul v-if="specializations.length">
        <li v-for="b in specializations" :key="b.id">
          <button type="button" :class="['first-run-chip', `branch-${b.color}`]" @click="emit('branch', b.id)">
            <span aria-hidden="true">{{ b.icon }}</span>{{ b.name }}
          </button>
        </li>
      </ul>
    </footer>
  </section>
</template>
