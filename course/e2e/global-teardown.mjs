// After every run: the sandbox tier's sandbox deleted and its learner signed out and deleted,
// whatever happened (Daytona bills for it, and it counts against MAX_SANDBOXES for real
// learners). Here rather than in the spec's afterAll, which also runs when a failed test's
// worker is replaced.
import fs from "node:fs";

import { request } from "@playwright/test";

import { BASE_URL, LEARNER_STATE, SANDBOX_EMAIL, SIGNIN_KEY } from "./env.mjs";
import { deleteLearner } from "./tests/accounts.mjs";

export async function deleteLearnerSandbox() {
  // Deleting the learner deletes their sandbox too, wherever the run got to.
  if (SIGNIN_KEY) await deleteLearner(SANDBOX_EMAIL).catch((err) => console.log(`deleting the sandbox learner: ${err.message}`));
  if (!fs.existsSync(LEARNER_STATE)) return;
  const api = await request.newContext({ baseURL: BASE_URL, storageState: LEARNER_STATE });
  try {
    const reset = await api.post("/api/sandbox/reset").catch((err) => err);
    console.log(`sandbox reset: ${reset.status?.() ?? reset.message}`);
    await api.delete("/api/session").catch(() => {});
  } finally {
    await api.dispose();
    fs.rmSync(LEARNER_STATE, { force: true });
  }
}

export default deleteLearnerSandbox;
