<script setup>
// The feedback form, in a modal: what kind, what happened, and where the learner was (filled in
// for them, and theirs to leave out). Closing it keeps the draft.
import { nextTick, onMounted, ref } from "vue";

import { closeFeedback, feedback, KINDS, MAX_MESSAGE, sendFeedback } from "../feedback.js";
import { store, toast } from "../store.js";

const box = ref(null);
onMounted(() => nextTick(() => box.value?.focus()));

async function submit() {
  if (await sendFeedback()) toast("Thanks! Your feedback is on its way to the course team.", 3200);
}

const placeholder = () =>
  ({
    bug: "What did you do, what happened, and what did you expect?",
    confusing: "What was unclear? What did you think it meant?",
    idea: "What would make this better?",
    praise: "What worked for you?",
  })[feedback.kind] ?? "What's on your mind? Anything about this page, the course or the sandbox.";
</script>

<template>
  <div class="modal-backdrop" @click.self="closeFeedback" @keydown.escape="closeFeedback">
    <form class="modal feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" @submit.prevent="submit">
      <h3 id="feedback-title">Send feedback</h3>
      <p>It goes straight to the course team{{ store.user ? `, and we can reply to ${store.user.email}` : "" }}.</p>

      <fieldset class="feedback-kinds">
        <legend class="visually-hidden">What kind of feedback</legend>
        <label v-for="k in KINDS" :key="k.id" class="feedback-kind" :class="{ active: feedback.kind === k.id }">
          <input v-model="feedback.kind" type="radio" name="feedback-kind" :value="k.id" class="visually-hidden">{{ k.label }}
        </label>
      </fieldset>

      <label class="visually-hidden" for="feedback-message">Your feedback</label>
      <textarea
        id="feedback-message"
        ref="box"
        v-model="feedback.draft"
        class="feedback-message"
        rows="6"
        :maxlength="MAX_MESSAGE"
        :placeholder="placeholder()"
        required
        @keydown.meta.enter.prevent="submit"
        @keydown.ctrl.enter.prevent="submit"
      />

      <div v-if="feedback.where?.label" class="feedback-where" :class="{ 'is-off': !feedback.attach }">
        <span class="feedback-where-label">{{ feedback.attach ? "About" : "Not attached" }}</span>
        <span class="feedback-where-text">{{ feedback.where.label }}</span>
        <button class="link-button" type="button" @click="feedback.attach = !feedback.attach">{{ feedback.attach ? "Leave out" : "Attach" }}</button>
      </div>

      <p v-if="feedback.error" class="form-error" role="alert">{{ feedback.error }}</p>
      <div class="status-actions feedback-actions">
        <button class="button" type="button" @click="closeFeedback">Cancel</button>
        <button class="button button-primary" type="submit" :disabled="feedback.busy || !feedback.draft.trim()">{{ feedback.busy ? "Sending…" : "Send feedback" }}</button>
      </div>
    </form>
  </div>
</template>
