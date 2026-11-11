<script setup>
// Signing in: an email, the 6-digit code sent to it, and the first time, name and role. Someone
// whose company isn't on the allowlist files an access request with the same form, and waits.
// Personal addresses are asked for a company one.
import { computed, nextTick, ref } from "vue";

import { requestCode, resumeSandbox, sandboxWanted, saveProfile, signOut, startSandbox, store, verifyCode } from "../store.js";

const props = defineProps({
  // The button's words, and whether signing in also starts the sandbox (not from the helper).
  label: { type: String, default: "Start my sandbox" },
  start: { type: Boolean, default: true },
});
const emit = defineEmits(["done"]);

const ROLES = ["Developer", "Architect", "Engineering manager", "Platform/SRE", "Data/ML", "Product owner", "Sales manager", "Marketing", "Other"];

const email = ref("");
const code = ref("");
const sentTo = ref("");
const toConsole = ref(false);
const name = ref(store.user?.name ?? "");
const role = ref(store.user?.role ?? "");
const error = ref("");
const busy = ref(false);
const codeInput = ref(null);

// Where the learner is: email → code → profile (or the access request) → done, or waiting.
const step = computed(() => {
  const user = store.user;
  if (!user) return sentTo.value ? "code" : "email";
  if (user.allowed) return user.needsProfile ? "profile" : "done";
  if (user.ended) return "ended";
  if (user.request?.status === "pending") return "pending";
  if (user.request?.status === "rejected") return "rejected";
  return "request";
});

function finish() {
  emit("done");
  // Without starting one, still find the sandbox they have (as loading the page does), or the
  // panes would wait for it forever: where the page uses it (sandboxWanted), or when asked to.
  if (store.runtime.enabled && (props.start || sandboxWanted())) (props.start ? startSandbox : resumeSandbox)();
}

async function run(fn) {
  busy.value = true;
  error.value = "";
  try {
    await fn();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

const sendCode = () =>
  run(async () => {
    const { email: normalized, console: printed, signedIn } = await requestCode(email.value);
    if (signedIn) {
      if (step.value === "done") finish();
      return;
    }
    sentTo.value = normalized;
    toConsole.value = printed;
    code.value = "";
    await nextTick();
    codeInput.value?.focus();
  });

const checkCode = () =>
  run(async () => {
    await verifyCode(sentTo.value, code.value);
    name.value = store.user?.name ?? "";
    role.value = store.user?.role ?? "";
    if (step.value === "done") finish();
  });

const sendProfile = () =>
  run(async () => {
    await saveProfile(name.value, role.value);
    if (step.value === "done") finish();
  });

function otherEmail() {
  sentTo.value = "";
  code.value = "";
  error.value = "";
  if (store.user) signOut();
}
</script>

<template>
  <div class="access-form">
    <p v-if="!store.signInInfo.enabled" class="form-error">Signing in isn't available here: {{ store.signInInfo.reason }}</p>

    <form v-else-if="step === 'email'" @submit.prevent="sendCode">
      <label for="access-email">Your work email</label>
      <div class="access-row">
        <input id="access-email" v-model="email" type="email" autocomplete="email" spellcheck="false" placeholder="you@company.com" required>
        <button class="button button-primary" type="submit" :disabled="busy || !email.trim()">{{ busy ? "Sending…" : "Email me a code" }}</button>
      </div>
      <p class="access-note">We use your email to sign you in and track your course progress.</p>
    </form>

    <form v-else-if="step === 'code'" @submit.prevent="checkCode">
      <label for="access-code">The 6-digit code {{ toConsole ? "in the runner's console" : `we sent to ${sentTo}` }}</label>
      <div class="access-row">
        <input
          id="access-code"
          ref="codeInput"
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          spellcheck="false"
          placeholder="123456"
          required
        >
        <button class="button button-primary" type="submit" :disabled="busy || code.replace(/\D/g, '').length !== 6">{{ busy ? "Checking…" : label }}</button>
      </div>
      <!-- Codes can land in junk mail: say so where it can't be missed. -->
      <p v-if="!toConsole" class="access-junk" role="note">
        <span class="access-junk-icon" aria-hidden="true">📬</span>
        <span><strong>No email?</strong> Check your <strong>junk or spam</strong> folder. It comes from Temporal Quest, <strong>signin@temporalquest.dev</strong>, and can take a minute.</span>
      </p>
      <p class="access-note">
        It works for 10 minutes.
        <button class="link-button" type="button" :disabled="busy" @click="sendCode">Send a new code</button> ·
        <button class="link-button" type="button" @click="otherEmail">Use another email</button>
      </p>
    </form>

    <form v-else-if="step === 'profile' || step === 'request'" @submit.prevent="sendProfile">
      <template v-if="step === 'request'">
        <p class="access-heading">Request access</p>
        <p class="access-note access-note-top">{{ store.user.email }} isn't registered for the course yet. Tell us who you are and we'll email you when you're in.</p>
      </template>
      <p v-else class="access-heading">One more thing: who are you?</p>
      <label for="access-name">Your name</label>
      <div class="access-row">
        <input id="access-name" v-model="name" type="text" autocomplete="name" maxlength="100" required>
      </div>
      <label for="access-role" class="access-label-gap">Your role</label>
      <div class="access-row">
        <select id="access-role" v-model="role" required>
          <option value="" disabled>Pick one</option>
          <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <div class="access-row access-row-end">
        <button class="button button-primary" type="submit" :disabled="busy || !name.trim() || !role">
          {{ busy ? "Saving…" : step === "request" ? "Request access" : label }}
        </button>
      </div>
    </form>

    <div v-else-if="step === 'pending'" class="access-wait">
      <p class="access-heading">Request pending</p>
      <p class="access-note access-note-top">We'll email {{ store.user.email }} when you're in. Meanwhile, explore the map.</p>
      <button class="link-button" type="button" @click="otherEmail">Use another email</button>
    </div>

    <div v-else-if="step === 'rejected'" class="access-wait">
      <p class="access-heading">Your request wasn't approved</p>
      <p v-if="store.user.request.reason" class="access-note access-note-top">{{ store.user.request.reason }}</p>
      <button class="link-button" type="button" @click="otherEmail">Use another email</button>
    </div>

    <div v-else-if="step === 'ended'" class="access-wait">
      <p class="access-heading">Your cohort has ended</p>
      <p class="access-note access-note-top">Ask your instructor or the course team to carry on.</p>
      <button class="link-button" type="button" @click="otherEmail">Use another email</button>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>
  </div>
</template>
