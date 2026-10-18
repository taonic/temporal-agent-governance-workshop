<script setup>
// Running the workshop on your own machine: the README's setup sections.
import { course, store } from "../store.js";

function onClick(event) {
  const copy = event.target.closest("button[data-copy]");
  if (!copy) return;
  navigator.clipboard?.writeText(copy.closest(".snippet")?.querySelector("pre")?.innerText ?? "");
}
</script>

<template>
  <main class="page-shell">
    <section class="reading markdown" @click="onClick">
      <p class="eyebrow">Set up on your machine</p>
      <p v-if="store.runtime.enabled" class="callout">
        Rather not install anything? Every exercise also runs in a browser sandbox: open one and pick <strong>Browser</strong>.
      </p>
      <div v-html="course.setup.html" />
    </section>
  </main>
</template>
