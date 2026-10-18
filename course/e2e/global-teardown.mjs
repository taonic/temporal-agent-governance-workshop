// After every run: the sandbox tier's sandbox deleted and its learner signed out, whatever
// happened (Daytona bills for it, and it counts against MAX_SANDBOXES for real learners). Here
// rather than in the spec's afterAll, which also runs when a failed test's worker is replaced.
import fs from "node:fs";

import { request } from "@playwright/test";

import { BASE_URL, LEARNER_STATE } from "./env.mjs";

export async function deleteLearnerSandbox() {
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
