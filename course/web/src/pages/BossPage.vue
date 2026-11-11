<script setup>
// A boss fight (boss.js): its stories one at a time, each "what happens next?" with three or four
// answers. A right answer knocks an HP off the boss, a wrong one costs a heart, and says why, with
// the module that teaches it. Win: the boss is done (its XP, its class badge, Flawless with every
// heart). Lose: try again, with a new draw. Nothing is kept mid-fight: leaving starts it over.
import { computed, ref } from "vue";

import { BOSS_HP, advance, answer, answered, current, drawFight } from "../boss.js";
import { HEARTS } from "../badges.js";
import { branchesById, finishBoss, isDone, moduleHref, modulesById } from "../progress.js";

const props = defineProps({ id: { type: String, required: true } });

const boss = computed(() => modulesById.get(props.id));
const branch = computed(() => branchesById.get(boss.value.branch));
const fight = ref(null);
const hit = ref(0); // bumped on each answer, to replay the hit's animation
const story = computed(() => (fight.value ? fight.value.stories[fight.value.at] : null));
const last = computed(() => (fight.value && answered(fight.value) ? fight.value.answers.at(-1) : null));
const rightCount = computed(() => fight.value?.answers.filter((a) => a.right).length ?? 0);
const teacher = computed(() => (story.value ? modulesById.get(story.value.module) : null));

function start() {
  fight.value = drawFight(boss.value.pool);
}

function pick(i) {
  if (!fight.value || answered(fight.value)) return;
  fight.value = answer(fight.value, i);
  hit.value++;
  if (fight.value.outcome) finishBoss(props.id, fight.value.outcome === "won", fight.value.hearts);
}

function next() {
  fight.value = advance(fight.value);
}

const done = computed(() => isDone(props.id));
const LETTERS = "ABCD";
</script>

<template>
  <main v-if="boss" :class="['boss-page', `branch-${branch.color}`]">
    <section class="boss-card" aria-labelledby="boss-title">
      <header class="boss-head">
        <p class="eyebrow">Boss · {{ branch.name }}</p>
        <h1 id="boss-title">{{ boss.title }}</h1>
        <div v-if="fight" class="boss-meters">
          <div class="boss-hp" role="meter" :aria-valuenow="fight.hp" aria-valuemin="0" :aria-valuemax="BOSS_HP" :aria-label="`The boss: ${fight.hp} of ${BOSS_HP}`">
            <span :key="`b-${hit}`" :class="['boss-face', { 'is-hit': last?.right }]" aria-hidden="true">🌙</span>
            <span v-for="n in BOSS_HP" :key="n" :class="['boss-seg', { 'is-gone': n > fight.hp }]" />
          </div>
          <div class="boss-hearts" role="meter" :aria-valuenow="fight.hearts" aria-valuemin="0" :aria-valuemax="HEARTS" :aria-label="`Your hearts: ${fight.hearts} of ${HEARTS}`">
            <span v-for="n in HEARTS" :key="`${n}-${n > fight.hearts ? hit : 0}`" :class="['boss-heart', { 'is-lost': n > fight.hearts }]" aria-hidden="true">{{ n > fight.hearts ? "🖤" : "❤️" }}</span>
          </div>
        </div>
      </header>

      <!-- Before the fight: what it is, and how it's won. -->
      <div v-if="!fight" class="boss-intro">
        <p class="boss-teaser">{{ boss.teaser }}</p>
        <ul class="boss-rules">
          <li><span aria-hidden="true">🌙</span> The night shift has {{ BOSS_HP }} HP. Each right answer knocks one off.</li>
          <li><span aria-hidden="true">❤️</span> You have {{ HEARTS }} hearts. Each wrong answer costs one, and says why.</li>
          <li><span aria-hidden="true">🔁</span> Lose them all and you start again, with new stories.</li>
        </ul>
        <p v-if="done" class="boss-done">✓ You've beaten it already. Again, for fun?</p>
        <button type="button" class="button button-primary boss-go" @click="start">{{ done ? "Fight it again" : "Start the night shift" }} <span aria-hidden="true">→</span></button>
      </div>

      <!-- The fight's over. -->
      <div v-else-if="fight.outcome === 'won'" class="boss-end is-won" role="status">
        <p class="boss-end-big" aria-hidden="true">🌅</p>
        <h2>Morning. You saw the night shift through.</h2>
        <p>{{ rightCount }} right, with {{ fight.hearts }} of {{ HEARTS }} hearts left{{ fight.hearts === HEARTS ? ": flawless" : "" }}. Whatever breaks, you know what a trip on Temporal does next.</p>
        <div class="boss-actions">
          <a class="button button-secondary" href="#/badges">See your badges</a>
          <a class="button button-primary" href="#/">Back to the map</a>
        </div>
      </div>
      <div v-else-if="fight.outcome === 'lost'" class="boss-end is-lost" role="status">
        <p class="boss-end-big" aria-hidden="true">🌙</p>
        <h2>The night shift won this time.</h2>
        <p>You got {{ rightCount }} right. Each miss said why, and which step teaches it. New stories next time.</p>
        <div class="boss-actions">
          <a class="button button-secondary" href="#/">Back to the map</a>
          <button type="button" class="button button-primary" @click="start">Try again <span aria-hidden="true">→</span></button>
        </div>
      </div>

      <!-- A story. -->
      <div v-else-if="story" class="boss-story">
        <p class="boss-kicker">Story {{ fight.at + 1 }}</p>
        <p class="boss-text">{{ story.story }}</p>
        <ol class="challenge-choices">
          <li v-for="(c, i) in story.choices" :key="c.label">
            <button
              type="button"
              class="challenge-choice"
              :class="{ 'is-right': last && c.right, 'is-struck': last && last.choice === i && !c.right }"
              :disabled="Boolean(last)"
              @click="pick(i)"
            >
              <span class="challenge-letter">{{ LETTERS[i] }}</span>
              <span class="challenge-label">{{ c.label }}</span>
              <span v-if="last && c.right" class="challenge-mark" aria-label="right">✓</span>
              <span v-else-if="last && last.choice === i" class="challenge-mark" aria-label="wrong">✗</span>
            </button>
          </li>
        </ol>
        <div v-if="last" :class="['boss-why', last.right ? 'is-right' : 'is-wrong']" role="status">
          <p><strong>{{ last.right ? "Right." : "Not quite." }}</strong> {{ story.why }}</p>
          <p v-if="!last.right && teacher" class="boss-revisit">Revisit <a :href="moduleHref(teacher.id)">{{ teacher.title }}</a> for this one.</p>
          <button type="button" class="button button-primary" @click="next">Next story <span aria-hidden="true">→</span></button>
        </div>
      </div>
    </section>
  </main>
</template>
