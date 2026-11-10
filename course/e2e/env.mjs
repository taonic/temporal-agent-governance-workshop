import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

// What the tests run against, and the secrets that unlock the higher tiers.
export const BASE_URL = (process.env.E2E_BASE_URL || "https://temporalquest.dev").replace(/\/$/, "");
// The app's E2E_SIGNIN_KEY: the tests' addresses (e2e+…@temporalquest.dev) sign in with a code
// derived from it, so no mailbox is needed. Without it, the @auth and @sandbox tiers skip.
export const SIGNIN_KEY = process.env.E2E_SIGNIN_KEY || "";
// The tests' admin: one of the app's ADMIN_EMAILS. It puts the tests' learners on the allowlist
// and deletes them after.
export const ADMIN_EMAIL = (process.env.E2E_ADMIN_EMAIL || "e2e+admin@temporalquest.dev").toLowerCase();
// The sandbox tier's learner, the same every run (the teardown deletes it).
export const SANDBOX_EMAIL = "e2e+sandbox@temporalquest.dev";
// Set to 1 to keep the sandbox tier off even with the key (during an event, say).
export const SKIP_SANDBOX = /^(1|true|yes)$/i.test(process.env.E2E_SKIP_SANDBOX || "");
// The sandbox tier's learner (its cookies), kept for the run: a test after a failure, in a new
// worker, signs in as the same learner, and the teardown deletes its sandbox. Outside the
// reports, which are uploaded.
export const LEARNER_STATE = path.join(os.tmpdir(), "governed-course-e2e-learner.json");

// The code for one of the tests' addresses, as the runner derives it (runner/auth.mjs
// e2eSignInCode).
export function e2eCode(email) {
  const digest = crypto.createHmac("sha256", SIGNIN_KEY).update(`e2e-signin:${email}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

// A fresh address for one test's learner.
export function learnerEmail(tag) {
  return `e2e+${tag}-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}@temporalquest.dev`;
}
