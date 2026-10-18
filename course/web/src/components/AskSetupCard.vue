<script setup>
// The guide's first getting-started step (ExerciseInstructions): Ask Temporal made ready (the
// workshop's sign-in, then Kapa's one-time human check), so the first question doesn't stop for
// it. The guide's replies move on, or skip it: someone who can't sign in with GitHub or Google
// still does the whole workshop.
import { computed } from "vue";

import { connectDocs, helper } from "../helper.js";
import { store } from "../store.js";
import AccessForm from "./AccessForm.vue";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const status = computed(() => helper.status);
</script>

<template>
  <div class="ask-setup-card">
    <p>Ask Temporal answers your questions from Temporal's docs, with links, and knows which exercise you're on. Ask it from the box at the bottom of this guide, or with {{ isMac ? "⌘K" : "Ctrl+K" }} anywhere.</p>

    <p v-if="!status.checked" class="ask-setup-note">Checking Ask Temporal…</p>
    <p v-else-if="!status.enabled" class="ask-setup-note">Ask Temporal isn't available here{{ status.reason ? ` (${status.reason})` : "" }}. You can still do the whole workshop.</p>
    <p v-else-if="status.signedIn && status.docs === 'ready'" class="ask-setup-done">✓ Ask Temporal is ready.</p>

    <template v-else-if="!status.signedIn">
      <p>{{ store.runtime.codeRequired ? "First, the access code your instructor gave you." : "First, sign in to this workshop." }} It also starts your sandbox.</p>
      <AccessForm label="Continue" />
    </template>

    <template v-else>
      <p>The docs search is <a href="https://www.kapa.ai" target="_blank" rel="noopener">Kapa</a>'s, and it asks each person to confirm they're human once, with GitHub or Google. It's only a sign-in check: Kapa doesn't get your name or email, and it can't access your Gmail, your Google account's data or your GitHub repositories.</p>
      <button class="button button-primary" type="button" :disabled="helper.connecting" @click="connectDocs">
        {{ helper.connecting ? "Waiting for the sign-in window…" : "Verify with GitHub or Google" }}
      </button>
    </template>
  </div>
</template>
