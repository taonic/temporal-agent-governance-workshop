<script setup>
// The whole skill tree, every node named. Fundamentals is the trunk across the top: tier I left
// to right, tier II back right to left below it, its boss at the end (a capstone, not a gate).
// The specializations hang below in columns, a node and its name a row, each column's boss at its
// foot. A branch says what it opens after (F7, or another branch's module); the limbs from the
// trunk go to the branches that open after it.
//
// A click (or Enter) on a node selects it: the detail panel says what it is and how to start.
// On a path, its modules are numbered in order, and the rest of the tree steps back. A tier with
// a badge leads its label with it, filled once earned: a link to the badge shelf.
import { computed } from "vue";

import NodeGlyph from "./NodeGlyph.vue";
import { medalSvg } from "../badgeArt.js";
import { course } from "../store.js";
import { STATE_LABEL, activePath, badges, branchesById, gatesOf, isDone, isEarned, isPlayable, modulesById, opensAfter, routeTo, stateOf, trunk, trunkTail } from "../progress.js";

const props = defineProps({
  selected: { type: String, default: null },
  // A branch to show the way to: it and everything it builds on stay lit, the rest steps back.
  toward: { type: String, default: null },
});
const route = computed(() => (props.toward ? routeTo(branchesById.get(props.toward)) : null));
const offRoute = (id) => Boolean(route.value) && !route.value.has(id);
// A zone, limb or edge is on the way when its branch (or both its ends) is.
const zoneOff = (branch) => Boolean(route.value) && branch.id !== props.toward && branch.id !== trunk.id && ![...route.value].some((id) => modulesById.get(id).branch === branch.id);
const emit = defineEmits(["select"]);

const W = 1100;
const COL_W = 220;
const STEP = 112; // between nodes in a trunk row
const LINE = 14; // a label's line height
const NODE = 40; // a node's glyph
const BOSS = 48;
const MEDAL = 24; // a tier's badge, before its label
const tierBadge = (branch, tier) => badges.find((b) => b.kind === "tier" && b.branch === branch && b.tier === tier) ?? null;

// A title, wrapped into lines of at most `chars`, at most `max` lines.
function wrap(text, chars, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > chars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > max) lines.splice(max - 1, lines.length, `${lines.slice(max - 1).join(" ").slice(0, chars - 1)}…`);
  return lines;
}

const layout = computed(() => {
  const nodes = new Map(); // id → { x, y, label: { x, y, anchor, lines } }
  const tierLabels = [];
  const zones = [];
  const trunkMods = (t) => trunk.modules.filter((id) => modulesById.get(id).tier === t);

  // The trunk: tier I, then tier II back below it, the boss at its end.
  const rowY = [104, 268];
  const tierOne = trunkMods(1);
  const startX = W / 2 - ((tierOne.length - 1) * STEP) / 2;
  tierOne.forEach((id, i) => {
    const x = startX + i * STEP;
    nodes.set(id, { x, y: rowY[0], label: { x, y: rowY[0] + 36, anchor: "middle", lines: [kicker(id), ...wrap(title(id), 16, 3)] } });
  });
  const rightX = startX + (tierOne.length - 1) * STEP;
  const tierTwo = [...trunkMods(2), ...(trunk.boss ? [trunk.boss] : [])];
  tierTwo.forEach((id, i) => {
    const x = rightX - i * STEP;
    const lines = [kicker(id), ...wrap(title(id), 16, id === trunk.boss ? 2 : 3)];
    nodes.set(id, { x, y: rowY[1], label: { x, y: rowY[1] + (id === trunk.boss ? 40 : 36), anchor: "middle", lines } });
  });
  tierLabels.push({ key: "trunk-1", x: startX - 26, y: rowY[0] - 40, text: `Tier I · ${trunk.tiers[0].name}`, badge: tierBadge(trunk.id, 1) });
  tierLabels.push({ key: "trunk-2", x: startX - 26, y: rowY[1] - 40, text: `Tier II · ${trunk.tiers[1].name}`, badge: tierBadge(trunk.id, 2) });
  // The turn from tier I's end down to tier II's start, outside both rows' labels.
  const turn = { from: tierOne.at(-1), to: tierTwo[0], x: rightX + 60 };
  const trunkZone = { branch: trunk, x: 16, y: 12, w: W - 32, h: rowY[1] + 92 - 12 };

  // Where the branches open.
  const junction = { x: W / 2, y: trunkZone.y + trunkZone.h + 34 };

  // The columns.
  const top = junction.y + 64;
  let bottom = 0;
  const columns = course.branches.filter((b) => b.column).sort((a, b) => a.column - b.column);
  for (const branch of columns) {
    const left = (branch.column - 1) * COL_W;
    const track = left + 36;
    const after = opensAfter(branch);
    let y = top + 104;
    branch.tiers.forEach((tier, t) => {
      const ids = branch.modules.filter((id) => modulesById.get(id).tier === t + 1);
      if (!ids.length) return;
      tierLabels.push({ key: `${branch.id}-${t}`, branch, x: left + 18, y, text: `${roman(t + 1)} · ${tier.name}`, badge: tierBadge(branch.id, t + 1) });
      y += 30;
      for (const id of ids) {
        const lines = [kicker(id), ...wrap(title(id), 21, 3)];
        nodes.set(id, { x: track, y, label: { x: track + 30, y: y - ((lines.length - 1) * LINE) / 2 + 4, anchor: "start", lines } });
        y += Math.max(54, lines.length * LINE + 18);
      }
      y += 8;
    });
    if (branch.boss) {
      y += 14;
      const lines = [kicker(branch.boss), ...wrap(title(branch.boss), 19, 2)];
      nodes.set(branch.boss, { x: track, y, boss: true, label: { x: track + 34, y: y - ((lines.length - 1) * LINE) / 2 + 4, anchor: "start", lines } });
      y += 40;
    }
    zones.push({ branch, after, x: left + 6, y: top, w: COL_W - 12, h: y - top, head: { x: left + COL_W / 2, y: top + 34 }, root: { x: left + COL_W / 2, y: top + 2 } });
    bottom = Math.max(bottom, y);
  }

  return { W, H: bottom + 24, nodes, zones, trunkZone, tierLabels, turn, junction };
});

// A node's label: its number (or what kind it is) on a line of its own, set apart from its title.
function title(id) {
  return modulesById.get(id).title;
}
function kicker(id) {
  const m = modulesById.get(id);
  return m.kind === "boss" ? "Boss" : m.kind === "challenge" ? "Challenge" : m.id;
}
function roman(n) {
  return ["", "I", "II", "III", "IV", "V"][n] ?? String(n);
}

const all = computed(() => [...layout.value.nodes.keys()].map((id) => modulesById.get(id)));
const pathIndex = computed(() => new Map((activePath.value?.modules ?? []).map((id, i) => [id, i + 1])));
const tail = modulesById.get(trunkTail);

// The limbs: from the junction to each branch that opens after the trunk.
const limbs = computed(() =>
  layout.value.zones
    .filter((z) => z.after.some((r) => r.branch === trunk.id))
    .map((z) => {
      const { junction: j } = layout.value;
      const end = z.root;
      const midY = (j.y + end.y) / 2;
      return { branch: z.branch, lit: z.after.every((r) => isDone(r.id)), d: `M ${j.x} ${j.y} C ${j.x} ${midY + 8}, ${end.x} ${midY - 8}, ${end.x} ${end.y}` };
    }),
);

// The prerequisite lines, within a branch (the trunk's turn is drawn on its own).
const edges = computed(() => {
  const { nodes, turn } = layout.value;
  const out = [];
  for (const m of all.value) {
    for (const req of [...m.requires, ...gatesOf(m.id)]) {
      const a = nodes.get(req);
      const b = nodes.get(m.id);
      if (!a || !b || modulesById.get(req).branch !== m.branch) continue;
      // A challenge between them: the line runs through it (after → challenge → before).
      if (course.modules.some((c) => c.kind === "challenge" && c.after === req && c.before === m.id)) continue;
      const lit = isDone(req);
      const key = `${req}-${m.id}`;
      const ends = { from: req, to: m.id };
      const color = branchesById.get(m.branch).color;
      if (req === turn.from || (modulesById.get(req).tier === 1 && m.tier === 2 && m.branch === trunk.id)) {
        // Tier I's end to tier II's start, round the outside.
        out.push({ key, lit, color, ...ends, d: `M ${a.x + 20} ${a.y} H ${turn.x} V ${b.y} H ${b.x + 20}` });
      } else out.push({ key, lit, color, ...ends, d: `M ${a.x} ${a.y} L ${b.x} ${b.y}` });
    }
  }
  // A boss follows the last module of its branch.
  for (const branch of course.branches) {
    if (!branch.boss) continue;
    const last = branch.modules.at(-1);
    const a = nodes.get(last);
    const b = nodes.get(branch.boss);
    if (a && b && !modulesById.get(branch.boss).requires.includes(last)) out.push({ key: `${last}-${branch.boss}`, lit: isDone(last), color: branch.color, from: last, to: branch.boss, d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, faint: true });
  }
  return out;
});

const nodeLabel = (m) =>
  `${m.kind === "boss" ? "Boss" : m.kind === "challenge" ? "Challenge" : m.id}: ${m.title}. ${STATE_LABEL[stateOf(m)]}${isPlayable(m) ? "" : ", coming soon"}`;
</script>

<template>
  <div class="skill-map">
    <svg class="skill-map-svg" :viewBox="`0 0 ${layout.W} ${layout.H}`" role="group" aria-label="The skill tree">
      <!-- Zones: the trunk across the top, a column per branch below. -->
      <rect
        v-for="zone in [layout.trunkZone, ...layout.zones]"
        :key="`zone-${zone.branch.id}`"
        :class="['map-zone', `branch-${zone.branch.color}`, { 'off-route': zoneOff(zone.branch), 'is-toward': zone.branch.id === toward }]"
        :x="zone.x" :y="zone.y" :width="zone.w" :height="zone.h" rx="18"
      />
      <text :class="['map-header-name', 'is-trunk', `branch-${trunk.color}`]" :x="layout.trunkZone.x + 18" :y="layout.trunkZone.y + 28">
        {{ trunk.icon }} {{ trunk.name }} · start here
      </text>

      <!-- From the trunk to the junction, and the limbs from it. -->
      <line :class="['map-limb', `branch-${trunk.color}`, { 'is-lit': isDone(trunkTail) }]" :x1="layout.junction.x" :y1="layout.trunkZone.y + layout.trunkZone.h" :x2="layout.junction.x" :y2="layout.junction.y" />
      <path v-for="limb in limbs" :key="`limb-${limb.branch.id}`" :class="['map-limb', `branch-${limb.branch.color}`, { 'is-lit': limb.lit, 'is-toward': toward && !zoneOff(limb.branch), 'off-route': zoneOff(limb.branch) }]" :d="limb.d" />
      <g class="map-junction" role="button" tabindex="0" :aria-label="`Branches open after ${tail.id}: ${tail.title}`" @click="emit('select', tail.id)" @keydown.enter.prevent="emit('select', tail.id)">
        <rect :x="layout.junction.x - 118" :y="layout.junction.y - 14" width="236" height="28" rx="14" />
        <text :x="layout.junction.x" :y="layout.junction.y + 4.5" text-anchor="middle">Specializations open after {{ tail.id }}</text>
      </g>

      <!-- Branch headers: the name, and what it opens after. -->
      <g v-for="zone in layout.zones" :key="`head-${zone.branch.id}`" :class="[`branch-${zone.branch.color}`, { 'off-route': zoneOff(zone.branch) }]">
        <text class="map-header-name" :x="zone.head.x" :y="zone.head.y" text-anchor="middle">{{ zone.branch.icon }} {{ zone.branch.name }}</text>
        <text class="map-header-after" :x="zone.head.x" :y="zone.head.y + 22" text-anchor="middle">
          Opens after
          <tspan
            v-for="(r, i) in zone.after"
            :key="r.id"
            :class="['map-header-req', `branch-${branchesById.get(r.branch).color}`]"
            @click="emit('select', r.id)"
          >{{ i ? ", " : "" }}{{ r.id }}</tspan>
        </text>
        <text v-if="!zone.branch.modules.some((id) => isPlayable(modulesById.get(id)))" class="map-header-soon" :x="zone.head.x" :y="zone.head.y + 42" text-anchor="middle">Coming soon</text>
      </g>

      <g v-for="label in layout.tierLabels" :key="`tier-${label.key}`" :class="{ 'off-route': label.branch && zoneOff(label.branch) }">
        <a v-if="label.badge" class="map-tier-badge" href="#/badges" :data-badge="label.badge.id" :data-earned="isEarned(label.badge.id) || null">
          <title>{{ label.badge.name }}{{ isEarned(label.badge.id) ? " · earned" : `: ${label.badge.criteria}` }}</title>
          <g :transform="`translate(${label.x} ${label.y - 19})`" v-html="medalSvg(label.badge, { earned: isEarned(label.badge.id), size: MEDAL })" />
        </a>
        <text class="map-tier" :x="label.badge ? label.x + MEDAL + 5 : label.x" :y="label.y">{{ label.text }}</text>
      </g>

      <!-- Prerequisites. -->
      <path v-for="edge in edges" :key="edge.key" :class="['map-edge', `branch-${edge.color}`, { 'is-lit': edge.lit, 'is-faint': edge.faint, 'off-route': offRoute(edge.from) || offRoute(edge.to) }]" :d="edge.d" />

      <!-- The nodes, each with its name. -->
      <g
        v-for="m in all"
        :key="m.id"
        :class="['map-node', `is-${stateOf(m)}`, `branch-${branchesById.get(m.branch).color}`, { 'is-soon': !isPlayable(m), 'is-selected': selected === m.id, 'off-path': pathIndex.size && !pathIndex.has(m.id), 'off-route': offRoute(m.id) }]"
        :data-module="m.id"
        :data-exercise="m.exercise || null"
        tabindex="0"
        role="button"
        :aria-pressed="selected === m.id"
        :aria-label="nodeLabel(m)"
        @click="emit('select', m.id)"
        @keydown.enter.prevent="emit('select', m.id)"
        @keydown.space.prevent="emit('select', m.id)"
      >
        <rect
          v-if="layout.nodes.get(m.id).label.anchor === 'start'"
          class="map-node-hit"
          :x="layout.nodes.get(m.id).x - 24" :y="layout.nodes.get(m.id).y - 24" :width="COL_W - 30" height="48" rx="12"
        />
        <rect v-else class="map-node-hit" :x="layout.nodes.get(m.id).x - STEP / 2 + 4" :y="layout.nodes.get(m.id).y - 26" :width="STEP - 8" height="98" rx="12" />
        <NodeGlyph
          :kind="m.kind"
          :state="stateOf(m)"
          :label="m.id"
          :soon="!isPlayable(m)"
          :size="m.kind === 'boss' ? BOSS : NODE"
          :x="layout.nodes.get(m.id).x"
          :y="layout.nodes.get(m.id).y"
          halo
        />
        <text class="map-label" :x="layout.nodes.get(m.id).label.x" :y="layout.nodes.get(m.id).label.y" :text-anchor="layout.nodes.get(m.id).label.anchor">
          <tspan
            v-for="(line, i) in layout.nodes.get(m.id).label.lines"
            :key="i"
            :x="layout.nodes.get(m.id).label.x"
            :dy="i ? LINE : 0"
            :class="{ 'map-label-id': i === 0, 'is-kind': i === 0 && m.kind !== 'module' }"
          >{{ line }}</tspan>
        </text>
        <g v-if="pathIndex.has(m.id)" class="map-path-badge">
          <circle :cx="layout.nodes.get(m.id).x + 16" :cy="layout.nodes.get(m.id).y - 16" r="9" />
          <text :x="layout.nodes.get(m.id).x + 16" :y="layout.nodes.get(m.id).y - 12.6" text-anchor="middle">{{ pathIndex.get(m.id) }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>
