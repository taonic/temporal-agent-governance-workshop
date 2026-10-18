<script setup>
// One message of an Ask Temporal conversation: the learner's question, or the answer with its
// docs searches, citations and sources, and what to do when it couldn't be answered. The panel
// and the guide both show their threads with it.
import { citedNumbers, renderAnswer } from "../answers.js";
import { connectDocs, helper, refreshHelper, retry } from "../helper.js";
import { toast } from "../store.js";
import AccessForm from "./AccessForm.vue";

const props = defineProps({
  message: { type: Object, required: true },
  // The thread it's in, to ask its last question again.
  thread: { type: Array, required: true },
});

const isLast = () => props.message === props.thread.at(-1);

// Cited sources first, in citation order; the rest folded away.
function sourceGroups(message) {
  const order = citedNumbers(message.content);
  const cited = order.map((n) => message.sources.find((s) => s.n === n)).filter(Boolean);
  const rest = message.sources.filter((s) => !order.includes(s.n));
  return { cited: cited.length ? cited : message.sources.slice(0, 3), rest: cited.length ? rest : message.sources.slice(3) };
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

function stepText(step) {
  if (step.state === "running") return `Searching the docs for “${step.query}”`;
  if (step.state === "done") return `Searched “${step.query}” · ${step.count === 1 ? "1 page" : `${step.count} pages`}`;
  if (step.state === "busy") return `The docs search is busy, so this answer isn't checked against the docs`;
  return `Couldn't search for “${step.query}”`;
}

function waitingText(message) {
  if (message.searches.some((s) => s.state === "running")) return "";
  return message.searches.length ? "Reading the docs and writing an answer…" : "Thinking…";
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy: select the text instead.");
  }
}

function signedIn() {
  refreshHelper().then(() => {
    if (props.thread.at(-1)?.error?.code === "access") retry(props.thread);
  });
}
</script>

<template>
  <article class="ask-message" :class="`is-${message.role}`">
    <template v-if="message.role === 'user'">
      <blockquote v-if="message.selection" class="ask-quote">{{ typeof message.selection === "string" ? message.selection : message.selection.text }}</blockquote>
      <div class="ask-bubble">{{ message.content }}</div>
      <div v-if="message.attached?.length" class="ask-attached">
        <span v-for="label in message.attached" :key="label">{{ label }}</span>
      </div>
    </template>

    <template v-else>
      <ul v-if="message.searches.length" class="ask-steps">
        <li v-for="step in message.searches" :key="step.id" :class="`is-${step.state}`">
          <span v-if="step.state === 'running'" class="ask-spinner" aria-hidden="true" />
          <span v-else class="ask-step-icon" aria-hidden="true">{{ step.state === "done" ? "✓" : "!" }}</span>
          {{ stepText(step) }}
        </li>
      </ul>

      <p v-if="message.state === 'streaming' && !message.content && waitingText(message)" class="ask-waiting">
        <span class="ask-dots" aria-hidden="true"><i /><i /><i /></span>{{ waitingText(message) }}
      </p>

      <div v-if="message.content" class="ask-answer markdown" :class="{ streaming: message.state === 'streaming' }" v-html="renderAnswer(message.content, message.sources)" />

      <div v-if="message.error" class="ask-error" :class="`code-${message.error.code}`">
        <template v-if="message.error.code === 'verify'">
          <p><strong>Connect the Temporal docs to get an answer.</strong> Kapa, which runs the docs search, asks each person to confirm they're human once, with GitHub or Google. Your question will be asked as soon as you're back.</p>
          <button class="button button-primary" type="button" :disabled="helper.connecting" @click="connectDocs">
            {{ helper.connecting ? "Waiting for the sign-in window…" : "Verify with GitHub or Google" }}
          </button>
        </template>
        <template v-else-if="message.error.code === 'access'">
          <p>{{ message.error.message }}</p>
          <AccessForm label="Unlock" :start="false" @done="signedIn" />
        </template>
        <template v-else>
          <p>{{ message.error.message }}</p>
          <button v-if="isLast()" class="button" type="button" :disabled="helper.busy" @click="retry(thread)">Try again</button>
        </template>
      </div>

      <p v-if="message.state === 'stopped' && isLast()" class="ask-stopped">
        Stopped. <button class="link-button" type="button" :disabled="helper.busy" @click="retry(thread)">Ask again</button>
      </p>

      <section v-if="message.sources.length && message.state !== 'streaming'" class="ask-sources" aria-label="Sources">
        <h4>Sources</h4>
        <a v-for="source in sourceGroups(message).cited" :key="source.n" class="ask-source" :href="source.url || undefined" target="_blank" rel="noopener noreferrer">
          <span class="ask-source-n">{{ source.n }}</span>
          <span class="ask-source-text"><span class="ask-source-title">{{ source.title }}</span><span class="ask-source-url">{{ shortUrl(source.url) }}</span></span>
        </a>
        <details v-if="sourceGroups(message).rest.length" class="ask-more-sources">
          <summary>{{ sourceGroups(message).rest.length }} more from the search</summary>
          <a v-for="source in sourceGroups(message).rest" :key="source.n" class="ask-source" :href="source.url || undefined" target="_blank" rel="noopener noreferrer">
            <span class="ask-source-n">{{ source.n }}</span>
            <span class="ask-source-text"><span class="ask-source-title">{{ source.title }}</span><span class="ask-source-url">{{ shortUrl(source.url) }}</span></span>
          </a>
        </details>
      </section>

      <div v-if="message.state === 'done' && message.content" class="ask-message-actions">
        <button class="link-button" type="button" @click="copy(message.content)">Copy answer</button>
      </div>
    </template>
  </article>
</template>
