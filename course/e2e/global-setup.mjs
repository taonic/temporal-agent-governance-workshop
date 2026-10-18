// The Fly machine stops when idle (min_machines_running = 0), so the first request of a run
// can wait for it to start. Wake it once here, so no test pays for it in its own timeout.
import { BASE_URL } from "./env.mjs";
import { deleteLearnerSandbox } from "./global-teardown.mjs";

export default async function globalSetup() {
  await wake();
  // A run that died before its teardown left its learner behind: its sandbox goes now, and this
  // run signs in afresh.
  await deleteLearnerSandbox();
}

async function wake() {
  const deadline = Date.now() + 90_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`${BASE_URL}/api/health didn't answer within 90s (last: ${last})`);
}
