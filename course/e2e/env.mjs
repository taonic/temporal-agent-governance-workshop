import os from "node:os";
import path from "node:path";

// What the tests run against, and the secrets that unlock the higher tiers.
export const BASE_URL = (process.env.E2E_BASE_URL || "https://temporal-agent-governance-workshop.fly.dev").replace(/\/$/, "");
export const ACCESS_CODE = process.env.E2E_ACCESS_CODE || "";
export const INSTRUCTOR_CODE = process.env.E2E_INSTRUCTOR_CODE || "";
// Set to 1 to keep the sandbox tier off even with an access code (during an event, say).
export const SKIP_SANDBOX = /^(1|true|yes)$/i.test(process.env.E2E_SKIP_SANDBOX || "");
// The sandbox tier's learner (its cookies), kept for the run: a test after a failure, in a new
// worker, signs in as the same learner, and the teardown deletes its sandbox. Outside the
// reports, which are uploaded.
export const LEARNER_STATE = path.join(os.tmpdir(), "governed-course-e2e-learner.json");
