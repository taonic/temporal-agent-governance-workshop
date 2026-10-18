// Learners are anonymous: entering the event's access code gets a random learner id, signed
// into a cookie. The id is what a sandbox is labeled with, so a learner can only ever reach
// their own sandbox, and the sandbox's model key is signed from it too.
import crypto from "node:crypto";

export const SESSION_COOKIE = "course_session";
const MAX_AGE_SECONDS = 30 * 24 * 3600;

function sign(secret, purpose, value) {
  return crypto.createHmac("sha256", secret).update(`${purpose}:${value}`).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function newLearnerId() {
  return crypto.randomBytes(12).toString("base64url");
}

const LEARNER_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function sessionToken(secret, learnerId) {
  return `${learnerId}.${sign(secret, "session", learnerId)}`;
}

export function verifySessionToken(secret, token) {
  const [id, sig, extra] = String(token ?? "").split(".");
  if (extra !== undefined || !LEARNER_ID.test(id ?? "") || !sig) return null;
  return safeEqual(sig, sign(secret, "session", id)) ? id : null;
}

// The key a sandbox sends to the model passthrough. Distinct from the session token, so the
// key in a sandbox's .env can't be replayed as a browser session. Dot-separated: ids and
// signatures are base64url, which uses "_" and "-" but never ".".
export function llmKey(secret, learnerId) {
  return `cl.${learnerId}.${sign(secret, "llm", learnerId)}`;
}

export function verifyLlmKey(secret, key) {
  const match = String(key ?? "").match(/^cl\.([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return safeEqual(match[2], sign(secret, "llm", match[1])) ? match[1] : null;
}

export function codeMatches(expected, given) {
  if (!expected) return false;
  // Hash both so the comparison is constant-time whatever the lengths.
  const h = (v) => crypto.createHash("sha256").update(String(v ?? "").trim()).digest();
  return crypto.timingSafeEqual(h(expected), h(given));
}

// "a, b,,c" → ["a", "b", "c"]: ACCESS_CODE holds one code or several.
export function parseCodes(value) {
  return String(value ?? "").split(",").map((code) => code.trim()).filter(Boolean);
}

// Whether `given` is any of `codes`. Compares against every code, not stopping at a match.
export function codeMatchesAny(codes, given) {
  return codes.reduce((matched, code) => codeMatches(code, given) || matched, false);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

// Secure only over https, so plain-http local dev still gets the cookie. Host-only (no
// Domain), so it reaches the UI proxy on the same host's other port as well.
export function sessionCookie(token, { secure }) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearedSessionCookie({ secure }) {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

export function learnerFromRequest(secret, req) {
  return verifySessionToken(secret, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

// A value the browser holds but can't read or change (the helper's docs token): AES-256-GCM
// under a key derived from the session secret, bound to its purpose.
function sealKey(secret) {
  return crypto.createHash("sha256").update(`${secret}:seal`).digest();
}

export function seal(secret, purpose, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sealKey(secret), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(secret, purpose, sealed) {
  try {
    const raw = Buffer.from(String(sealed ?? ""), "base64url");
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", sealKey(secret), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

// A cookie of the runner's own, other than the session: HttpOnly, Lax, host-only, on a path.
export function plainCookie(name, value, { secure, path = "/", maxAge }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
