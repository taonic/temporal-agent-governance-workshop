// Signing the tests' learners in, through the API: a code to their e2e address (none is sent:
// the runner derives it from E2E_SIGNIN_KEY, and so do the tests), then the code back. The tests'
// admin puts each learner on the allowlist, in the "E2E" cohort, and deletes it after.
import { request } from "@playwright/test";

import { ADMIN_EMAIL, BASE_URL, e2eCode, learnerEmail } from "../env.mjs";

export const E2E_COHORT = "E2E";

// A request context signed in as `email`, with a name and role if it had none.
export async function signInApi(email, { profile = { name: "E2E Learner", role: "Developer" } } = {}) {
  const api = await request.newContext({ baseURL: BASE_URL });
  let verify;
  // A code works once: another worker signing the same address in (the admin) can use it up
  // between this one's asking and answering. Then ask again.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const start = await api.post("/api/auth/start", { data: { email } });
    if (start.status() !== 200) throw new Error(`asking for a code for ${email}: ${start.status()} ${await start.text()}`);
    verify = await api.post("/api/auth/verify", { data: { email, code: e2eCode(email) } });
    if (verify.status() === 200 || (await verify.json().catch(() => ({}))).code !== "expired") break;
    await new Promise((r) => setTimeout(r, 200 * attempt));
  }
  if (verify.status() !== 200) throw new Error(`signing ${email} in: ${verify.status()} ${await verify.text()} (is E2E_SIGNIN_KEY the app's?)`);
  let { user } = await verify.json();
  if (profile && user.needsProfile) user = (await (await api.post("/api/auth/profile", { data: profile })).json()).user;
  return { api, user };
}

// The tests' admin, signed in: { api, ok }. ok is false when ADMIN_EMAIL isn't one of the app's
// ADMIN_EMAILS (the tests that need it skip).
let admin = null;
export async function adminApi() {
  if (!admin) {
    const { api, user } = await signInApi(ADMIN_EMAIL, { profile: { name: "E2E Admin", role: "Other" } });
    admin = { api, ok: Boolean(user.admin) };
  }
  return admin;
}

export async function e2eCohort(api) {
  const { cohorts } = await (await api.get("/api/admin/overview")).json();
  const found = cohorts.find((c) => c.name === E2E_COHORT);
  if (found) return found.id;
  const res = await api.post("/api/admin/cohorts", { data: { name: E2E_COHORT, allowanceMinutes: 480 } });
  return (await res.json()).cohort.id;
}

// Puts an email on the allowlist (the E2E cohort).
export async function allow(email) {
  const { api, ok } = await adminApi();
  if (!ok) throw new Error(`${ADMIN_EMAIL} isn't one of the app's ADMIN_EMAILS`);
  const cohortId = await e2eCohort(api);
  const res = await api.post("/api/admin/allowlist", { data: { cohortId, text: email } });
  if (res.status() !== 200) throw new Error(`allowlisting ${email}: ${res.status()} ${await res.text()}`);
  return cohortId;
}

// The learner's id, as the admin sees it, or null.
export async function learnerId(email) {
  const { api } = await adminApi();
  const { learners } = await (await api.get("/api/admin/learners")).json();
  return learners.find((l) => l.email === email)?.id ?? null;
}

// Deletes a learner (their user, events, allowlist entry and sandbox).
export async function deleteLearner(email) {
  const { api, ok } = await adminApi();
  if (!ok) return;
  const id = await learnerId(email);
  if (id) await api.delete(`/api/admin/learner?id=${encodeURIComponent(id)}`);
}

// A new learner, allowed and signed in: { email, api, user, cookies, dispose }.
export async function newLearner(tag) {
  const email = learnerEmail(tag);
  await allow(email);
  const { api, user } = await signInApi(email);
  const { cookies } = await api.storageState();
  return {
    email,
    api,
    user,
    cookies,
    async dispose() {
      await api.dispose();
      await deleteLearner(email);
    },
  };
}
