<script setup>
// The workshop's front door: one way in, Start, which opens exercise 1. Its guide takes it from
// there: Ask Temporal's setup, the page tour, then the exercise.
import { course, navigate, store } from "../store.js";

const first = course.exercises[0];

function start() {
  navigate(`#/exercise/${first.id}`);
}
</script>

<template>
  <main class="page-shell home-shell">
    <section class="hero">
      <p class="eyebrow">Temporal Workshop · 4 hours, hands-on</p>
      <h1>{{ course.title }}</h1>
      <p class="hero-line">The model decides what to try. The policy decides what is allowed.</p>
      <div class="hero-actions">
        <button class="button button-primary button-start" type="button" @click="start">
          Start the workshop<span class="button-start-arrow" aria-hidden="true">→</span>
        </button>
      </div>
      <p v-if="store.runtime.checked && !store.runtime.enabled" class="hero-note">The browser sandbox isn't available here ({{ store.runtime.reason }}). Each exercise shows how to run it on your machine.</p>
      <p v-else class="hero-note">In the browser you get your own sandbox with Temporal and the agent already running. Nothing to install.</p>
    </section>
  </main>
</template>
