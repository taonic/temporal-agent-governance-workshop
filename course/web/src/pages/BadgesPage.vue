<script setup>
// The badge shelf (#/badges): a row per branch, its tier badges and then its boss badge (the
// class title), and the skill badges below. Unearned badges show greyed, with what earns them:
// there are no secret ones. An earned tier badge whose tier has grown since says so, and keeps it.
import { computed } from "vue";

import BadgeMedal from "../components/BadgeMedal.vue";
import { iconSvg } from "../badgeArt.js";
import { badgeComingSoon, badgeMissing, badges, earnedCount, isEarned, progress } from "../progress.js";
import { course } from "../store.js";

const rows = computed(() => [
  ...course.branches
    .map((branch) => ({
      key: branch.id,
      name: branch.name,
      icon: iconSvg(branch.badgeIcon, 18, branch.color),
      tiers: badges.filter((b) => b.branch === branch.id && b.kind === "tier"),
      boss: badges.find((b) => b.branch === branch.id && b.kind === "boss") ?? null,
    }))
    .filter((row) => row.tiers.length || row.boss),
  { key: "skills", name: "Skills", icon: iconSvg("bolt", 18), tiers: badges.filter((b) => b.kind === "skill"), boss: null, skills: true },
]);

const date = (at) => (at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
function note(badge) {
  if (isEarned(badge.id)) {
    const grown = badgeMissing(badge).length;
    return { earned: true, when: date(progress.badges[badge.id]), grown: grown ? `+${grown} new module${grown === 1 ? "" : "s"}` : "" };
  }
  return { earned: false, soon: badgeComingSoon(badge) };
}
const kicker = (badge) => (badge.kind === "tier" ? `Tier ${badge.numeral} · ${badge.tierName}` : badge.kind === "boss" ? "Class title" : "");
</script>

<template>
  <main class="badges-page">
    <header class="badges-head">
      <p class="panel-kicker">Your badges</p>
      <h1>{{ earnedCount }} of {{ badges.length }} earned</h1>
      <p class="badges-lede">A badge for every tier you finish and every boss you beat, which is your class title, and a few for how you learn. Badges you haven't earned yet say what earns them.</p>
    </header>
    <section class="badges-shelf" aria-label="Badges">
      <div v-for="row in rows" :key="row.key" class="badges-row" :class="{ 'is-skills': row.skills }">
        <h2 class="badges-row-label"><span v-html="row.icon" />{{ row.name }}</h2>
        <ul class="badges-row-items">
          <template v-for="badge in [...row.tiers, ...(row.boss ? [row.boss] : [])]" :key="badge.id">
            <li v-if="badge.kind === 'boss' && row.tiers.length" class="badges-divider" aria-hidden="true" />
            <li class="badge-card" :class="{ 'is-locked': !note(badge).earned }" :data-badge="badge.id" :data-earned="note(badge).earned || null">
              <BadgeMedal :badge="badge" :earned="note(badge).earned" :size="96" />
              <p v-if="kicker(badge)" class="badge-card-kicker">{{ kicker(badge) }}</p>
              <h3 class="badge-card-name">{{ badge.name }}</h3>
              <p class="badge-card-criteria">{{ badge.criteria }}</p>
              <p v-if="note(badge).earned" class="badge-card-when">Earned {{ note(badge).when }}</p>
              <p v-else-if="note(badge).soon" class="badge-card-soon">Coming soon</p>
              <p v-if="note(badge).grown" class="badge-card-grown" :title="`Still yours. The tier has ${note(badge).grown.slice(1)} since you earned it.`">{{ note(badge).grown }}</p>
            </li>
          </template>
        </ul>
      </div>
    </section>
  </main>
</template>
