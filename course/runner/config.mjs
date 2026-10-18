// The runner's settings, all from the environment. See course/DEPLOY.md for what to set.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { snapshotName } from "./repo-files.mjs";

const env = process.env;
const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|localhost|::1|\[::1\])$/i;
const int = (name, fallback) => (env[name] ? Number.parseInt(env[name], 10) : fallback);
const trimSlash = (value) => (value ? value.replace(/\/+$/, "") : "");

// Signs session cookies and the sandboxes' model keys. Set SESSION_SECRET when deployed. A
// local runner without one keeps the one it makes in course/.session-secret (git-ignored):
// it restarts on every change under runner/, and a new secret would sign you out and, once
// you signed in again, give you a new learner and so a new sandbox. Anywhere else, a random
// one, so everyone signs in again after a restart.
export const SECRET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".session-secret");
function sessionSecret() {
  if (env.SESSION_SECRET) return { secret: env.SESSION_SECRET, kept: false };
  const fresh = crypto.randomBytes(32).toString("hex");
  if (!LOOPBACK.test(env.HOST ?? "127.0.0.1")) return { secret: fresh, kept: false };
  try {
    const saved = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (saved.length >= 32) return { secret: saved, kept: true };
  } catch {
    /* none yet */
  }
  try {
    fs.writeFileSync(SECRET_FILE, `${fresh}\n`, { mode: 0o600 });
    return { secret: fresh, kept: true };
  } catch {
    return { secret: fresh, kept: false };
  }
}
const secret = sessionSecret();

export const config = {
  host: env.HOST ?? "127.0.0.1",
  port: int("PORT", 8787),
  // The built site, served from the same origin as /api in production. Unset in local dev,
  // where Vite serves the site and proxies to the runner.
  distDir: env.COURSE_DIST_DIR || null,
  // The Temporal UI needs an origin of its own (it uses root-absolute paths), so it's
  // proxied on a second port of the same host, which keeps the session cookie same-site.
  uiProxyPort: int("UI_PROXY_PORT", int("PORT", 8787) + 1),
  uiProxyPublicBase: trimSlash(env.UI_PROXY_PUBLIC_BASE),
  // Where sandboxes reach this runner (the model passthrough). Defaults to the origin the
  // learner's browser used; set it when that origin isn't reachable from Daytona (local dev
  // behind a tunnel).
  publicUrl: trimSlash(env.PUBLIC_URL),

  daytonaApiKey: env.DAYTONA_API_KEY || env.DAYTONA_KEY || "",
  snapshot: env.SANDBOX_SNAPSHOT || snapshotName(),
  maxSandboxes: int("MAX_SANDBOXES", 40),
  autoStopMinutes: int("SANDBOX_AUTO_STOP_MINUTES", 30),
  ttlMinutes: int("SANDBOX_TTL_MINUTES", 24 * 60),

  // One code per event. Without one, the runtime is open only when the runner listens on a
  // loopback address (local dev, where only this machine can reach it), or with
  // ALLOW_OPEN_ACCESS=1; otherwise it's off.
  accessCode: env.ACCESS_CODE || "",
  allowOpenAccess: env.ALLOW_OPEN_ACCESS === "1",
  localOnly: LOOPBACK.test(env.HOST ?? "127.0.0.1"),
  instructorCode: env.INSTRUCTOR_CODE || "",
  // See sessionSecret() above.
  sessionSecret: secret.secret,
  sessionSecretIsEphemeral: !env.SESSION_SECRET && !secret.kept,
  sessionSecretKept: secret.kept,

  // The model passthrough: sandboxes get a per-sandbox key for /llm/v1, never the real one.
  geminiApiKey: env.GEMINI_API_KEY || "",
  llmUpstream: trimSlash(env.LLM_UPSTREAM_URL || "https://generativelanguage.googleapis.com/v1beta/openai"),
  llmModel: env.LLM_MODEL || "gemini-3.8-flash",
  llmPerSandboxPerMinute: int("LLM_RATE_PER_SANDBOX", 20),
  llmGlobalPerMinute: int("LLM_RATE_GLOBAL", 300),
  llmTimeoutMs: int("LLM_TIMEOUT_SECONDS", 300) * 1000,

  // The helper ("Ask Temporal"): Gemini (the same key and upstream), answering from Temporal's
  // docs through Kapa's MCP server. Learners connect their own Kapa account (a one-click "are
  // you human" with GitHub or Google) unless KAPA_API_KEY is set, which serves everyone.
  helperModel: env.HELPER_MODEL || env.LLM_MODEL || "gemini-3.8-flash",
  helperReasoningEffort: env.HELPER_REASONING_EFFORT ?? "low",
  helperPerLearnerPerMinute: int("HELPER_RATE_PER_LEARNER", 6),
  helperGlobalPerMinute: int("HELPER_RATE_GLOBAL", 120),
  kapaMcpUrl: env.KAPA_MCP_URL || "https://temporal.mcp.kapa.ai/",
  kapaApiKey: env.KAPA_API_KEY || "",
  // Kapa allows 60 searches a minute per team, shared by every learner; stay under it.
  kapaSearchesPerMinute: int("KAPA_RATE_GLOBAL", 50),
};

// No code needed: ALLOW_OPEN_ACCESS=1, or a local runner with no ACCESS_CODE.
export function openAccess() {
  return !config.accessCode && (config.allowOpenAccess || config.localOnly);
}

// Who may get a session without a code. A local runner is still reachable through a tunnel
// (the one the sandboxes use for the model), so it only opens to requests addressed to this
// machine.
export function openAccessAllows(hostHeader) {
  if (config.allowOpenAccess) return true;
  const host = String(hostHeader ?? "").replace(/:\d+$/, "");
  return config.localOnly && LOOPBACK.test(host);
}

// Why nobody can get a session (no code to give out, and not open), or null.
function accessUnavailableReason() {
  if (!config.accessCode && !config.allowOpenAccess && !config.localOnly) return "The runner has no ACCESS_CODE.";
  return null;
}

// Why the browser runtime is off, or null when it's on.
export function runtimeUnavailableReason() {
  if (!config.daytonaApiKey) return "The runner has no DAYTONA_API_KEY.";
  return accessUnavailableReason();
}

// Why the helper is off, or null when it's on. It doesn't need the sandboxes, so learners
// working locally can use it too.
export function helperUnavailableReason() {
  if (!config.geminiApiKey) return "The runner has no GEMINI_API_KEY.";
  return accessUnavailableReason();
}
