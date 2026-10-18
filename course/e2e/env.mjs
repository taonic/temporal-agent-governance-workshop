// What the tests run against, and the secrets that unlock the higher tiers.
export const BASE_URL = (process.env.E2E_BASE_URL || "https://temporal-agent-governance-workshop.fly.dev").replace(/\/$/, "");
export const ACCESS_CODE = process.env.E2E_ACCESS_CODE || "";
export const INSTRUCTOR_CODE = process.env.E2E_INSTRUCTOR_CODE || "";
// Set to 1 to keep the sandbox tier off even with an access code (during an event, say).
export const SKIP_SANDBOX = /^(1|true|yes)$/i.test(process.env.E2E_SKIP_SANDBOX || "");
