<script setup>
// Where you are, in the top bar of a module: back to the map, the branch and the module, the
// branch's modules as a mini-map (each a link), and Next (the path's next, or the branch's).
import { computed } from "vue";

import { branchPosition, branchesById, idOf, isPlayable, moduleHref, moduleName, modulesById, nextModule, numbered, stateOf } from "../progress.js";
import { store } from "../store.js";

const props = defineProps({ exercise: { type: Object, required: true } });

const module = computed(() => modulesById.get(store.route.module) ?? modulesById.get(props.exercise.modules[0]));
const branch = computed(() => branchesById.get(module.value.branch));
const where = computed(() => branchPosition(module.value.id));
const siblings = computed(() => branch.value.modules.map((id) => modulesById.get(id)).filter(isPlayable));
const next = computed(() => nextModule(module.value.id));
</script>

<template>
  <nav class="module-nav" :class="`branch-${branch.color}`" aria-label="Where you are" data-tour="breadcrumb">
    <a class="button button-secondary module-nav-map" href="#/" title="Back to the skill tree">
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 17V9m0 0L5 5m5 4 5-4M5 5V2m10 3V2M10 9V4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      Map
    </a>
    <div class="module-crumb">
      <p class="module-crumb-branch">
        <span aria-hidden="true">{{ branch.icon }}</span> {{ branch.name }}
        <span class="module-crumb-pos">· {{ numbered(module) ? "" : "Step " }}{{ where.index }} of {{ where.total }}</span>
      </p>
      <p class="module-crumb-title" :title="moduleName(module)"><span v-if="idOf(module)" class="module-crumb-id">{{ module.id }}</span>{{ module.title }}</p>
    </div>
    <ol class="module-minimap" aria-label="This branch's modules">
      <li v-for="m in siblings" :key="m.id">
        <a
          :href="moduleHref(m.id)"
          :class="['minimap-dot', `is-${stateOf(m)}`, { 'is-current': m.id === module.id }]"
          :title="moduleName(m)"
          :aria-label="moduleName(m)"
          :aria-current="m.id === module.id ? 'step' : null"
        />
      </li>
    </ol>
    <a v-if="next" class="button button-secondary module-nav-next" :href="moduleHref(next.id)" :title="`Next: ${moduleName(next)}`">Next <span aria-hidden="true">→</span></a>
  </nav>
</template>
