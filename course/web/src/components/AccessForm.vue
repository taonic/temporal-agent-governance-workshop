<script setup>
import { ref } from "vue";

import { resumeSandbox, signIn, startSandbox, store } from "../store.js";

const props = defineProps({
  // The button's words, and whether signing in also starts the sandbox (not from the helper).
  label: { type: String, default: "Start my sandbox" },
  start: { type: Boolean, default: true },
});
const emit = defineEmits(["done"]);
const code = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    await signIn(code.value);
    emit("done");
    // Without starting one, still find the sandbox they have (as loading the page does), or the
    // panes would wait for it forever.
    if (store.runtime.enabled) (props.start ? startSandbox : resumeSandbox)();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="access-form" @submit.prevent="submit">
    <template v-if="store.runtime.codeRequired">
      <label for="access-code">Workshop access code</label>
      <div class="access-row">
        <input id="access-code" v-model="code" type="text" autocomplete="off" spellcheck="false" placeholder="From your instructor" required>
        <button class="button button-primary" type="submit" :disabled="busy || !code.trim()">{{ busy ? "Checking…" : label }}</button>
      </div>
    </template>
    <button v-else class="button button-primary" type="submit" :disabled="busy">{{ busy ? "Starting…" : label }}</button>
    <p v-if="error" class="form-error">{{ error }}</p>
  </form>
</template>
