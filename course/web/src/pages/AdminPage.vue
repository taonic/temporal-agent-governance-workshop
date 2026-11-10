<script setup>
// /admin, for ADMIN_EMAILS: who's learning and how it's going (Learners, with each learner's
// journey), who may sign in (Cohorts & allowlist), who's asking to (Requests), what's happening
// (Activity), what they tell us (Feedback), and the sandboxes. Refreshes every 10 seconds while the tab is visible.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { api, course, navigate, store, toast } from "../store.js";

const TABS = [
  { id: "learners", label: "Learners" },
  { id: "cohorts", label: "Cohorts & allowlist" },
  { id: "requests", label: "Requests" },
  { id: "activity", label: "Activity" },
  { id: "feedback", label: "Feedback" },
  { id: "sandboxes", label: "Sandboxes" },
];
const tab = computed(() => (TABS.some((t) => t.id === store.route.id) ? store.route.id : "learners"));

const overview = ref({ cohorts: [], pendingRequests: 0, paths: [], roles: [] });
const cohortFilter = ref("");
const error = ref("");

// --- Formatting -------------------------------------------------------------------------------

const modules = new Map(course.modules.map((m) => [m.id, m]));
const moduleLabel = (id) => (id ? `${id} · ${modules.get(id)?.title ?? ""}`.replace(/ · $/, "") : "");
function ago(ms) {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const when = (ms) => (ms ? new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
function duration(seconds) {
  const m = Math.round((seconds ?? 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
const hours = (minutes) => `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} h`;
const dateInput = (ms) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : "");

const EVENT_LABELS = {
  sign_in: "signed in",
  sign_out: "signed out",
  code_sent: "asked for a code",
  code_failed: "entered a wrong code",
  access_requested: "asked for access",
  access_approved: "was approved",
  access_rejected: "was turned down",
  module_opened: "opened",
  module_passed: "passed",
  check_failed: "failed the check of",
  challenge_pick: "picked in",
  boss_result: "fought",
  path_set: "chose a path",
  helper_question: "asked Temporal a question",
  model_calls: "made model calls",
  sandbox_create: "created a sandbox",
  sandbox_started: "sandbox started",
  sandbox_stopped: "sandbox stopped",
  sandbox_gone: "sandbox deleted",
  sandbox_reset: "started over with a new sandbox",
  allowance_reached: "ran out of sandbox time",
  allowlist_added: "allowlist: added",
  allowlist_removed: "allowlist: removed",
  cohort_created: "cohort created",
  cohort_saved: "cohort saved",
  user_blocked: "was blocked",
  user_unblocked: "was unblocked",
  user_deleted: "a learner was deleted",
  feedback_sent: "sent feedback",
};
function eventText(e) {
  const d = e.data ?? {};
  const label = EVENT_LABELS[e.type] ?? e.type;
  if (e.type === "challenge_pick") return `${label} ${e.moduleId}: ${d.choice}${d.right ? " ✓" : ""}`;
  if (e.type === "model_calls") return `${label} (${d.count})`;
  if (e.type === "path_set") return `${label}: ${d.path ?? "none"}`;
  if (e.type === "allowlist_added") return `${label} ${(d.entries ?? []).join(", ")} to ${d.cohort}`;
  if (e.type === "allowlist_removed") return `${label} ${d.entry}`;
  if (["cohort_created", "cohort_saved"].includes(e.type)) return `${label}: ${d.cohort}`;
  if (e.type === "feedback_sent") return `${label}${d.kind ? ` (${d.kind})` : ""}${e.moduleId ? ` on ${moduleLabel(e.moduleId)}` : ""}`;
  if (e.type === "boss_result") return `${label} ${e.moduleId}: ${d.won ? "won" : "lost"}`;
  if (e.moduleId) return `${label} ${moduleLabel(e.moduleId)}`;
  return label;
}
const byWhom = (e) => (e.data?.by ? ` (by ${e.data.by})` : "");

// --- Loading ----------------------------------------------------------------------------------

const learners = ref([]);
const summary = ref(null);
const requests = ref([]);
const feed = ref([]);
const feedTypes = ref([]);
const feedType = ref("");
const feedUser = ref("");
const sandboxes = ref({ max: 0, sandboxes: [] });
const feedbackList = ref([]);
const feedbackKind = ref("");
const journey = ref(null);
const selectedLearner = ref(null);
const cohortId = ref(null);
const entries = ref([]);

async function loadOverview() {
  overview.value = await api("/api/admin/overview");
}

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)).toString();
  return s ? `?${s}` : "";
};

async function load() {
  error.value = "";
  try {
    await loadOverview();
    if (tab.value === "learners") {
      if (selectedLearner.value) journey.value = await api(`/api/admin/learner${q({ id: selectedLearner.value })}`);
      const data = await api(`/api/admin/learners${q({ cohort: cohortFilter.value })}`);
      learners.value = data.learners;
      summary.value = data.summary;
    } else if (tab.value === "cohorts") {
      if (!cohortId.value && overview.value.cohorts.length) cohortId.value = overview.value.cohorts[0].id;
      if (cohortId.value) entries.value = (await api(`/api/admin/allowlist${q({ cohort: cohortId.value })}`)).entries;
    } else if (tab.value === "requests") {
      requests.value = (await api("/api/admin/requests")).requests;
    } else if (tab.value === "activity") {
      const data = await api(`/api/admin/activity${q({ cohort: cohortFilter.value, type: feedType.value, user: feedUser.value })}`);
      feed.value = data.events;
      feedTypes.value = data.types;
    } else if (tab.value === "feedback") {
      feedbackList.value = (await api("/api/admin/feedback")).feedback;
    } else if (tab.value === "sandboxes") {
      sandboxes.value = await api("/api/admin/sandboxes");
    }
  } catch (err) {
    error.value = err.message;
  }
}

let timer = 0;
onMounted(() => {
  load();
  timer = setInterval(() => document.visibilityState === "visible" && !editing.value && load(), 10_000);
});
onBeforeUnmount(() => clearInterval(timer));
watch([tab, cohortFilter, feedType, feedUser, selectedLearner, cohortId], load);

async function loadMoreFeed() {
  const last = feed.value.at(-1);
  if (!last) return;
  const data = await api(`/api/admin/activity${q({ cohort: cohortFilter.value, type: feedType.value, user: feedUser.value, before: last.id })}`);
  feed.value = [...feed.value, ...data.events];
}

async function act(fn, done) {
  try {
    await fn();
    if (done) toast(done);
    await load();
  } catch (err) {
    toast(err.message, 4000);
  }
}

// --- Learners ---------------------------------------------------------------------------------

const stuckCount = computed(() => learners.value.filter((l) => l.where?.stuck).length);
const sortedLearners = computed(() =>
  [...learners.value].sort((a, b) => Number(Boolean(b.where?.stuck)) - Number(Boolean(a.where?.stuck)) || (b.where?.lastAt ?? b.lastSeenAt ?? 0) - (a.where?.lastAt ?? a.lastSeenAt ?? 0)),
);
const maxPassed = computed(() => Math.max(1, ...(summary.value?.modules ?? []).map((m) => m.passed)));
// Along a cohort's path, every module on it; otherwise only the ones someone has passed.
const onPath = computed(() => Boolean(cohortFilter.value && overview.value.cohorts.find((c) => String(c.id) === cohortFilter.value)?.path));
const summaryModules = computed(() => (summary.value?.modules ?? []).filter((m) => onPath.value || m.passed > 0));

function openLearner(id) {
  selectedLearner.value = id;
  journey.value = null;
  window.scrollTo({ top: 0 });
}
function closeLearner() {
  selectedLearner.value = null;
  journey.value = null;
}

const moveTo = ref("");
const setStatus = (status) => act(() => api("/api/admin/learner", { method: "POST", body: { id: selectedLearner.value, status } }), status === "blocked" ? "Blocked: signed out on their next request" : "Unblocked");
function move() {
  if (!moveTo.value) return;
  act(() => api("/api/admin/learner", { method: "POST", body: { id: selectedLearner.value, cohortId: Number(moveTo.value) } }), "Moved");
  moveTo.value = "";
}
function deleteLearner() {
  const u = journey.value?.user;
  if (!u || !window.confirm(`Delete ${u.name || u.email}? Their account, their activity and their sandbox are removed, and their email comes off the allowlist. This can't be undone.`)) return;
  act(async () => {
    await api(`/api/admin/learner${q({ id: u.id })}`, { method: "DELETE" });
    closeLearner();
  }, "Learner deleted");
}

// --- Cohorts & allowlist ----------------------------------------------------------------------

const editing = ref(false); // a form is being typed in: don't refresh under it
const selectedCohort = computed(() => overview.value.cohorts.find((c) => c.id === cohortId.value) ?? null);
const form = ref({ id: null, name: "", path: "", endsAt: "", allowanceHours: 8 });
watch(
  selectedCohort,
  (c) => {
    if (!c || editing.value) return;
    form.value = { id: c.id, name: c.name, path: c.path ?? "", endsAt: dateInput(c.endsAt), allowanceHours: c.allowanceMinutes / 60 };
  },
  { immediate: true },
);
function newCohort() {
  cohortId.value = null;
  entries.value = [];
  form.value = { id: null, name: "", path: "", endsAt: "", allowanceHours: 8 };
  editing.value = true;
}
function saveCohort() {
  const f = form.value;
  // An end date ends the cohort at the end of that day, local time.
  const endsAt = f.endsAt ? new Date(`${f.endsAt}T23:59:59`).getTime() : null;
  act(async () => {
    const { cohort } = await api("/api/admin/cohorts", { method: "POST", body: { id: f.id, name: f.name, path: f.path || null, endsAt, allowanceMinutes: Math.round(Number(f.allowanceHours) * 60) } });
    editing.value = false;
    cohortId.value = cohort.id;
  }, "Cohort saved");
}
const paste = ref("");
function addEntries() {
  act(async () => {
    const { added, invalid } = await api("/api/admin/allowlist", { method: "POST", body: { cohortId: cohortId.value, text: paste.value } });
    paste.value = invalid.join("\n");
    toast(`${added.length} added${invalid.length ? `; ${invalid.length} not understood (left in the box)` : ""}`, 4000);
  });
}
function removeEntry(entry) {
  if (!window.confirm(`Remove ${entry.kind === "domain" ? "@" : ""}${entry.value}? Anyone it lets in loses access on their next request.`)) return;
  act(() => api(`/api/admin/allowlist${q({ id: entry.id })}`, { method: "DELETE" }), "Removed");
}

// --- Requests ---------------------------------------------------------------------------------

const pending = computed(() => requests.value.filter((r) => r.status === "pending"));
const decided = computed(() => requests.value.filter((r) => r.status !== "pending"));
function decide(r, approve, scope = "email") {
  let reason = "";
  if (!approve) {
    const answer = window.prompt(`Turn down ${r.name}'s request? A reason for them (optional):`, "");
    if (answer === null) return;
    reason = answer;
  } else if (scope === "domain" && !window.confirm(`Let everyone at @${r.domain} in? Anyone with an email there can sign in from now on.`)) return;
  act(() => api("/api/admin/requests/decide", { method: "POST", body: { id: r.id, approve, scope, reason } }), approve ? `Approved: ${r.email} has been emailed` : "Turned down");
}

// --- Feedback ---------------------------------------------------------------------------------

const FEEDBACK_KINDS = { bug: "broken", confusing: "confusing", idea: "idea", praise: "liked" };
const shownFeedback = computed(() => feedbackList.value.filter((f) => !feedbackKind.value || (f.kind ?? "none") === feedbackKind.value));
const feedbackHref = (f) => (f.context?.url ? `${window.location.origin}${window.location.pathname}${f.context.url}` : null);
function showLearner(id) {
  selectedLearner.value = id;
  journey.value = null;
  navigate("#/admin/learners");
}

const cohortName = (id) => overview.value.cohorts.find((c) => c.id === id)?.name ?? "";
</script>

<template>
  <main class="admin-page">
    <header class="admin-head">
      <div>
        <p class="panel-kicker">Temporal Quest</p>
        <h1>Admin panel</h1>
      </div>
      <nav class="admin-tabs" aria-label="Admin">
        <a
          v-for="t in TABS"
          :key="t.id"
          :href="`#/admin/${t.id}`"
          class="admin-tab"
          :class="{ active: tab === t.id }"
          :aria-current="tab === t.id ? 'page' : undefined"
          @click="t.id === 'learners' && closeLearner()"
        >
          {{ t.label }}<span v-if="t.id === 'requests' && overview.pendingRequests" class="admin-count">{{ overview.pendingRequests }}</span>
        </a>
      </nav>
    </header>
    <p v-if="error" class="form-error">{{ error }}</p>

    <!-- Learners, and one learner's journey -->
    <section v-if="tab === 'learners' && selectedLearner" class="admin-section">
      <button class="button button-secondary" type="button" @click="closeLearner">← All learners</button>
      <template v-if="journey">
        <div class="journey-head">
          <div>
            <h2>{{ journey.user.name || journey.user.email }}</h2>
            <p class="admin-muted">
              {{ journey.user.email }} · {{ journey.user.role || "no role yet" }} · {{ journey.user.company }} ·
              {{ journey.user.cohort?.name ?? "no cohort" }}{{ journey.user.admin ? " · admin" : "" }}
              <span v-if="journey.user.status === 'blocked'" class="admin-badge is-bad">blocked</span>
              <span v-else-if="!journey.user.allowed" class="admin-badge">not allowed</span>
            </p>
          </div>
          <div class="journey-actions">
            <select v-model="moveTo" aria-label="Move to cohort" @change="move">
              <option value="">Move to cohort…</option>
              <option v-for="c in overview.cohorts" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <button v-if="journey.user.status === 'blocked'" class="button" type="button" @click="setStatus('active')">Unblock</button>
            <button v-else class="button" type="button" @click="setStatus('blocked')">Block</button>
            <button class="button admin-danger" type="button" @click="deleteLearner">Delete learner</button>
          </div>
        </div>

        <div class="journey-stats">
          <div><span>XP</span><strong>{{ journey.xp }}</strong></div>
          <div><span>Modules passed</span><strong>{{ journey.passed.length }}</strong></div>
          <div :class="{ 'is-stuck': journey.where?.stuck }">
            <span>Now</span>
            <strong>{{ journey.where?.active ? moduleLabel(journey.where.moduleId) : "—" }}</strong>
            <em v-if="journey.where?.active">{{ journey.where.minutes }} min{{ journey.where.stuck ? " · stuck" : "" }}</em>
          </div>
          <div><span>Sandbox, last 24 h</span><strong>{{ duration(journey.sandbox.minutesToday * 60) }}</strong></div>
          <div><span>Questions to Ask Temporal</span><strong>{{ journey.helperQuestions }}</strong></div>
          <div><span>Model calls</span><strong>{{ journey.modelCalls }}</strong></div>
        </div>

        <div class="journey-grid">
          <div class="admin-card">
            <h3>Modules passed</h3>
            <table v-if="journey.passed.length" class="admin-table">
              <thead><tr><th>Module</th><th>Time on it</th><th>Failed checks</th><th>Passed</th></tr></thead>
              <tbody>
                <tr v-for="m in journey.passed" :key="m.id">
                  <td>{{ moduleLabel(m.id) }}</td><td>{{ duration(m.seconds) }}</td><td>{{ m.failedChecks || "" }}</td><td>{{ when(m.at) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="admin-muted">None yet.</p>
            <template v-if="journey.inProgress.length">
              <h3>Started, not passed</h3>
              <table class="admin-table">
                <tbody>
                  <tr v-for="m in journey.inProgress" :key="m.id"><td>{{ moduleLabel(m.id) }}</td><td>{{ duration(m.seconds) }}</td><td>{{ m.failedChecks ? `${m.failedChecks} failed checks` : "" }}</td></tr>
                </tbody>
              </table>
            </template>
          </div>
          <div class="admin-card">
            <h3>Challenges</h3>
            <ul v-if="journey.challenges.length" class="admin-list">
              <li v-for="c in journey.challenges" :key="c.id">
                <strong>{{ c.id }}</strong> {{ c.title }}:
                <span v-for="p in c.picks" :key="p.choice" class="pick" :class="p.right ? 'is-right' : 'is-wrong'" :title="p.label">{{ p.choice }}</span>
              </li>
            </ul>
            <p v-else class="admin-muted">None yet.</p>
            <h3>Bosses</h3>
            <ul v-if="journey.bosses.length" class="admin-list">
              <li v-for="(b, i) in journey.bosses" :key="i">{{ moduleLabel(b.moduleId) }}: {{ b.won ? "won" : "lost" }} · {{ when(b.at) }}</li>
            </ul>
            <p v-else class="admin-muted">None yet.</p>
            <h3>Sandbox sessions</h3>
            <ul v-if="journey.sandbox.sessions.length" class="admin-list">
              <li v-for="(s, i) in journey.sandbox.sessions" :key="i">{{ when(s.from) }} · {{ s.to ? `${s.minutes} min` : `running, ${s.minutes} min so far` }}</li>
            </ul>
            <p v-else class="admin-muted">None yet.</p>
          </div>
        </div>

        <div class="admin-card">
          <h3>Timeline</h3>
          <ol class="admin-feed">
            <li v-for="(e, i) in journey.timeline" :key="i"><time>{{ when(e.at) }}</time><span>{{ eventText(e) }}{{ byWhom(e) }}</span></li>
          </ol>
        </div>
      </template>
      <p v-else class="admin-muted">Loading…</p>
    </section>

    <section v-else-if="tab === 'learners'" class="admin-section">
      <div class="admin-toolbar">
        <select v-model="cohortFilter" aria-label="Cohort">
          <option value="">All cohorts</option>
          <option v-for="c in overview.cohorts" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
        </select>
        <span class="admin-muted">{{ learners.length }} learners<template v-if="stuckCount"> · <strong class="is-stuck-text">{{ stuckCount }} stuck</strong></template></span>
        <a class="button button-secondary" :href="`/api/admin/learners.csv${q({ cohort: cohortFilter })}`" download>Export CSV</a>
      </div>

      <div class="admin-card table-scroll">
        <table class="admin-table admin-learners">
          <thead>
            <tr><th>Learner</th><th>Role</th><th>Cohort</th><th>Now</th><th>Passed</th><th>XP</th><th>Sandbox (24 h)</th><th>Last active</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in sortedLearners" :key="l.id" :class="{ 'is-stuck': l.where?.stuck, 'is-blocked': l.status === 'blocked' }" tabindex="0" @click="openLearner(l.id)" @keydown.enter="openLearner(l.id)">
              <td>
                <strong>{{ l.name || "—" }}</strong><br><span class="admin-muted">{{ l.email }}</span>
                <span v-if="l.status === 'blocked'" class="admin-badge is-bad">blocked</span>
                <span v-else-if="!l.allowed" class="admin-badge">not allowed</span>
              </td>
              <td>{{ l.role }}<br><span class="admin-muted">{{ l.company }}</span></td>
              <td>{{ l.cohort?.name ?? "" }}</td>
              <td>
                <template v-if="l.where?.active">{{ moduleLabel(l.where.moduleId) }}<br><span class="admin-muted">{{ l.where.minutes }} min{{ l.where.stuck ? " · stuck" : "" }}</span></template>
                <span v-else class="admin-muted">—</span>
              </td>
              <td>{{ l.completed }}</td>
              <td>{{ l.xp }}</td>
              <td>{{ hours(l.sandboxMinutes) }} / {{ hours(l.allowanceMinutes) }}</td>
              <td>{{ ago(l.where?.lastAt ?? l.lastSeenAt) }}</td>
            </tr>
            <tr v-if="!learners.length"><td colspan="8" class="admin-muted">No learners yet.</td></tr>
          </tbody>
        </table>
      </div>

      <div v-if="summary" class="journey-grid">
        <div class="admin-card">
          <h3>Passed, per module {{ onPath ? "(the cohort's path)" : "" }}</h3>
          <p v-if="!onPath" class="admin-muted">Modules nobody has passed yet are left out.</p>
          <ul class="admin-bars">
            <li v-for="m in summaryModules" :key="m.id">
              <span class="bar-label" :title="m.title">{{ m.id }} · {{ m.title }}</span>
              <span class="bar"><span :style="{ width: `${(m.passed / maxPassed) * 100}%` }" /></span>
              <span class="bar-count">{{ m.passed }}</span>
            </li>
          </ul>
        </div>
        <div class="admin-card">
          <h3>Challenges</h3>
          <table v-if="summary.challenges.length" class="admin-table">
            <thead><tr><th>Challenge</th><th>Right first time</th><th>Most-picked wrong</th></tr></thead>
            <tbody>
              <tr v-for="c in summary.challenges" :key="c.id">
                <td>{{ c.id }} · {{ c.title }}</td>
                <td>{{ Math.round(c.firstTryRate * 100) }}% of {{ c.tried }}</td>
                <td>{{ c.mostPickedWrong ? `${c.mostPickedWrong.choice} (${c.mostPickedWrong.count})` : "—" }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="admin-muted">No picks yet.</p>
        </div>
      </div>
    </section>

    <!-- Cohorts & allowlist -->
    <section v-else-if="tab === 'cohorts'" class="admin-section admin-cohorts">
      <aside class="admin-card cohort-list">
        <button class="button button-primary" type="button" @click="newCohort">New cohort</button>
        <button
          v-for="c in overview.cohorts"
          :key="c.id"
          type="button"
          class="cohort-item"
          :class="{ active: c.id === cohortId, ended: !c.active }"
          @click="editing = false; cohortId = c.id"
        >
          <strong>{{ c.name }}</strong>
          <span class="admin-muted">{{ c.entryCount }} entries · {{ hours(c.allowanceMinutes) }}/day{{ c.endsAt ? ` · ${c.active ? "ends" : "ended"} ${when(c.endsAt)}` : "" }}</span>
        </button>
      </aside>
      <div class="cohort-detail">
        <form class="admin-card admin-form" @submit.prevent="saveCohort" @input="editing = true">
          <h3>{{ form.id ? `Cohort: ${selectedCohort?.name ?? ""}` : "New cohort" }}</h3>
          <label>Name <input v-model="form.name" type="text" required :disabled="selectedCohort?.builtin" maxlength="80"></label>
          <label>
            Path
            <select v-model="form.path">
              <option value="">None (the learner picks)</option>
              <option v-for="p in overview.paths" :key="p.id" :value="p.id">{{ p.title }}</option>
            </select>
          </label>
          <label>Ends (after this day, nobody in it can sign in) <input v-model="form.endsAt" type="date" :disabled="selectedCohort?.builtin"></label>
          <label>Sandbox time per learner, hours in any 24 <input v-model="form.allowanceHours" type="number" min="0" max="24" step="0.5" required></label>
          <div class="admin-form-actions">
            <button class="button button-primary" type="submit">Save cohort</button>
            <button v-if="editing" class="button" type="button" @click="editing = false; load()">Cancel</button>
          </div>
          <p v-if="selectedCohort?.builtin" class="admin-muted">Approved access requests land here. It never ends.</p>
        </form>

        <div v-if="cohortId" class="admin-card">
          <h3>Allowlist</h3>
          <form class="admin-form" @submit.prevent="addEntries">
            <label>
              <span>Add emails or domains, one per line: <code>jane@acme.com</code>, or <code>@acme.com</code> for everyone there</span>
              <textarea v-model="paste" rows="5" spellcheck="false" placeholder="jane@acme.com&#10;@globex.com" @focus="editing = true" @blur="editing = false" />
            </label>
            <div class="admin-form-actions"><button class="button button-primary" type="submit" :disabled="!paste.trim()">Add to {{ cohortName(cohortId) }}</button></div>
          </form>
          <table v-if="entries.length" class="admin-table">
            <tbody>
              <tr v-for="e in entries" :key="e.id">
                <td><code>{{ e.kind === "domain" ? "@" : "" }}{{ e.value }}</code></td>
                <td class="admin-muted">{{ e.kind === "domain" ? "everyone at it" : "" }}</td>
                <td class="admin-muted">{{ e.addedBy }} · {{ when(e.createdAt) }}</td>
                <td><button class="link-button" type="button" @click="removeEntry(e)">Remove</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="admin-muted">Nobody yet.</p>
        </div>
      </div>
    </section>

    <!-- Requests -->
    <section v-else-if="tab === 'requests'" class="admin-section">
      <div class="admin-toolbar">
        <span class="admin-muted">{{ pending.length }} pending</span>
        <a class="button button-secondary" href="/api/admin/requests.csv" download>Export CSV</a>
      </div>
      <div class="admin-card table-scroll">
        <table class="admin-table">
          <thead><tr><th>Who</th><th>Role</th><th>Company</th><th>Asked</th><th /></tr></thead>
          <tbody>
            <tr v-for="r in pending" :key="r.id">
              <td><strong>{{ r.name }}</strong><br><span class="admin-muted">{{ r.email }}</span></td>
              <td>{{ r.role }}</td>
              <td>{{ r.company }}</td>
              <td>{{ ago(r.createdAt) }}</td>
              <td class="request-actions">
                <button class="button button-primary" type="button" @click="decide(r, true, 'email')">Approve this email</button>
                <button class="button" type="button" @click="decide(r, true, 'domain')">Approve all of @{{ r.domain }}</button>
                <button class="button admin-danger" type="button" @click="decide(r, false)">Reject</button>
              </td>
            </tr>
            <tr v-if="!pending.length"><td colspan="5" class="admin-muted">No requests waiting.</td></tr>
          </tbody>
        </table>
      </div>
      <div v-if="decided.length" class="admin-card table-scroll">
        <h3>Decided</h3>
        <table class="admin-table">
          <tbody>
            <tr v-for="r in decided" :key="r.id">
              <td><strong>{{ r.name }}</strong> <span class="admin-muted">{{ r.email }}</span></td>
              <td>
                <span class="admin-badge" :class="{ 'is-bad': r.status === 'rejected' }">{{ r.status === "approved" ? (r.scope === "domain" ? `approved @${r.domain}` : "approved") : "rejected" }}</span>
                <span v-if="r.reason" class="admin-muted"> {{ r.reason }}</span>
              </td>
              <td class="admin-muted">{{ r.decidedBy }} · {{ when(r.decidedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Activity -->
    <section v-else-if="tab === 'activity'" class="admin-section">
      <div class="admin-toolbar">
        <select v-model="cohortFilter" aria-label="Cohort">
          <option value="">All cohorts</option>
          <option v-for="c in overview.cohorts" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
        </select>
        <select v-model="feedType" aria-label="Event type">
          <option value="">Every kind of event</option>
          <option v-for="t in feedTypes" :key="t" :value="t">{{ EVENT_LABELS[t] ?? t }}</option>
        </select>
        <button v-if="feedUser" class="button button-secondary" type="button" @click="feedUser = ''">Everyone</button>
      </div>
      <div class="admin-card">
        <ol class="admin-feed">
          <li v-for="e in feed" :key="e.id">
            <time>{{ when(e.at) }}</time>
            <span>
              <button v-if="e.userId && e.email" class="link-button" type="button" @click="feedUser = e.userId">{{ e.name || e.email }}</button>
              {{ eventText(e) }}{{ byWhom(e) }}
            </span>
          </li>
          <li v-if="!feed.length" class="admin-muted">Nothing yet.</li>
        </ol>
        <button v-if="feed.length >= 200" class="button" type="button" @click="loadMoreFeed">Older</button>
      </div>
    </section>

    <!-- Feedback -->
    <section v-else-if="tab === 'feedback'" class="admin-section">
      <div class="admin-toolbar">
        <select v-model="feedbackKind" aria-label="Kind">
          <option value="">Every kind</option>
          <option v-for="(label, id) in FEEDBACK_KINDS" :key="id" :value="id">{{ label }}</option>
          <option value="none">No kind given</option>
        </select>
        <span class="admin-muted">{{ shownFeedback.length }} of {{ feedbackList.length }}</span>
        <a class="button button-secondary" href="/api/admin/feedback.csv" download>Export CSV</a>
      </div>
      <div class="admin-card">
        <ol class="admin-feedback">
          <li v-for="f in shownFeedback" :key="f.id">
            <div class="admin-feedback-head">
              <button class="link-button" type="button" @click="showLearner(f.userId)">{{ f.name || f.email }}</button>
              <span class="admin-muted">{{ f.email }}{{ f.company ? ` · ${f.company}` : "" }}</span>
              <span v-if="f.kind" class="admin-badge" :class="{ 'is-bad': f.kind === 'bug', 'is-good': f.kind === 'praise' }">{{ FEEDBACK_KINDS[f.kind] ?? f.kind }}</span>
              <time class="admin-muted" :title="new Date(f.createdAt).toLocaleString()">{{ ago(f.createdAt) }}</time>
            </div>
            <p class="admin-feedback-message">{{ f.message }}</p>
            <p class="admin-muted admin-feedback-where">
              <a v-if="feedbackHref(f)" :href="feedbackHref(f)" target="_blank" rel="noopener">{{ f.where || f.context?.url }}</a>
              <span v-else>{{ f.where }}</span>
              <span v-if="f.context?.sandbox"> · sandbox {{ f.context.sandbox }}</span>
              <span v-if="f.context?.viewport?.width"> · {{ f.context.viewport.width }}×{{ f.context.viewport.height }}</span>
              <span v-if="!f.emailedAt"> · not emailed</span>
            </p>
          </li>
          <li v-if="!shownFeedback.length" class="admin-muted">No feedback yet.</li>
        </ol>
      </div>
    </section>

    <!-- Sandboxes -->
    <section v-else-if="tab === 'sandboxes'" class="admin-section">
      <p class="admin-muted">{{ sandboxes.sandboxes.length }} sandboxes, at most {{ sandboxes.max }} running.</p>
      <div class="admin-card table-scroll">
        <table class="admin-table">
          <thead><tr><th>Learner</th><th>State</th><th>Exercise</th><th>Last seen</th><th>Created</th></tr></thead>
          <tbody>
            <tr v-for="s in sandboxes.sandboxes" :key="s.id">
              <td>{{ s.name || s.email || s.learner }}<br><span class="admin-muted">{{ s.email && s.name ? s.email : s.id }}</span></td>
              <td><span class="admin-badge" :class="{ 'is-good': s.state === 'started' }">{{ s.state }}</span></td>
              <td>{{ s.exercise ?? "" }}</td>
              <td>{{ s.lastSeenAt ? ago(Date.parse(s.lastSeenAt)) : "" }}</td>
              <td>{{ s.createdAt ? when(Date.parse(s.createdAt)) : "" }}</td>
            </tr>
            <tr v-if="!sandboxes.sandboxes.length"><td colspan="5" class="admin-muted">No sandboxes.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>
