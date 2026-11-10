// The course runner: serves the built site and its /api, proxies each learner's sandbox
// (console under /sbx/console/, the Temporal UI on its own port), bridges the terminals and
// the editor's language server over WebSockets, and relays the sandboxes' model calls (/llm/v1/).
//
//   node course/runner/server.mjs
//
// Settings are environment variables: see config.mjs and course/DEPLOY.md.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { WebSocketServer } from "ws";

import { Accounts, DEFAULT_ALLOWANCE_MINUTES } from "./accounts.mjs";
import { Activity } from "./activity.mjs";
import { createAdmin } from "./admin.mjs";
import { clearedSessionCookie, learnerFromRequest, sessionCookie, sessionToken } from "./auth.mjs";
import { config, consoleSignIn, consoleSignInAllows, helperUnavailableReason, runtimeUnavailableReason, signInUnavailableReason } from "./config.mjs";
import { openDatabase } from "./db.mjs";
import { Feedback } from "./feedback.mjs";
import { createHelper } from "./helper.mjs";
import { createLlmPassthrough } from "./llm.mjs";
import { relayLsp } from "./lsp.mjs";
import { createMailer } from "./mailer.mjs";
import { harnessConsole, proxyRequest, temporalUi } from "./proxy.mjs";
import { CONSOLE_PORT, SandboxManager, TEMPORAL_UI_PORT } from "./sandboxes.mjs";
import { createSweep } from "./sweep.mjs";
import { TERMINALS, TerminalHub } from "./terminals.mjs";

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

const db = openDatabase(config.databasePath);
const activity = new Activity(db);
const accounts = new Accounts(db, {
  secret: config.sessionSecret,
  adminEmails: config.adminEmails,
  consoleSignIn,
  e2eKey: config.e2eSignInKey,
  record: (...args) => activity.record(...args),
});
const feedback = new Feedback(db, { record: (...args) => activity.record(...args) });
const mailer = createMailer(config, { log });
const manager = new SandboxManager(config);
const terminals = new TerminalHub(manager);
const llm = createLlmPassthrough(config, { onCall: (learner) => activity.countModelCall(learner) });
const distDir = config.distDir ? path.resolve(config.distDir) : null;

// Who's signed in: the user, with their access (accounts.mjs sessionUser), or null.
function sessionOf(req) {
  const id = learnerFromRequest(config.sessionSecret, req);
  return id ? accounts.sessionUser(id) : null;
}

// The learner id of a signed-in user who may use the course, or null.
function activeLearner(req) {
  const session = sessionOf(req);
  return session?.access.allowed ? session.id : null;
}

const helper = createHelper(config, {
  learnerOf: activeLearner,
  siteOrigin: (req) => origins(req).site,
  secure: (req) => isHttps(req),
  unavailable: helperUnavailableReason,
  log,
});

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(payload));
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("The request body isn't JSON."), { status: 400 });
  }
}

function isHttps(req) {
  return (req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https" || Boolean(req.socket.encrypted);
}

// The origins the learner's browser uses: the course site, and the UI proxy beside it.
function origins(req) {
  const proto = isHttps(req) ? "https" : "http";
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${config.port}`).split(",")[0].trim();
  const hostname = host.replace(/:\d+$/, "");
  return {
    site: `${proto}://${host}`,
    ui: config.uiProxyPublicBase || `${proto}://${hostname}:${config.uiProxyPort}`,
  };
}

function uiProxyInfo() {
  return { uiProxyBase: config.uiProxyPublicBase || null, uiProxyPort: config.uiProxyPublicBase ? null : config.uiProxyPort };
}

function clientIp(req) {
  return String(req.headers["fly-client-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
}

// A signed-in user who may use the course (whatever the runtime's state): their session.
function requireUser(req) {
  const session = sessionOf(req);
  if (!session) throw Object.assign(new Error("Sign in first."), { status: 401 });
  if (!session.access.allowed) {
    const why = session.access.ended ? "Your cohort has ended." : "Your access request hasn't been approved yet.";
    throw Object.assign(new Error(why), { status: 403, code: "not_allowed" });
  }
  return session;
}

function requireLearner(req) {
  const reason = runtimeUnavailableReason();
  if (reason) throw Object.assign(new Error(reason), { status: 503 });
  return requireUser(req).id;
}

function allowanceOf(learner) {
  const user = accounts.user(learner);
  const cohort = user ? accounts.accessFor(user.email).cohort : null;
  return activity.allowance(learner, cohort?.allowance_minutes ?? DEFAULT_ALLOWANCE_MINUTES);
}

const admin = createAdmin({ accounts, activity, feedback, manager, mailer, readJson, sessionOf, siteOrigin: (req) => origins(req).site, log });

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function serveStatic(req, res, urlPath) {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(distDir, rel);
  if (!file.startsWith(distDir)) file = path.join(distDir, "index.html");
  let body;
  try {
    if ((await fs.stat(file)).isDirectory()) throw new Error("directory");
    body = await fs.readFile(file);
  } catch {
    file = path.join(distDir, "index.html");
    body = await fs.readFile(file);
  }
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "content-type": contentTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

// --- /api ---------------------------------------------------------------------------------

const routes = {
  "GET /api/health": async () => ({ ok: true, runtime: { enabled: !runtimeUnavailableReason() }, ...uiProxyInfo() }),

  "GET /api/session": async (req) => {
    const reason = runtimeUnavailableReason();
    const helperReason = helperUnavailableReason();
    const signInReason = signInUnavailableReason();
    const session = sessionOf(req);
    return {
      runtime: { enabled: !reason, reason },
      helper: { enabled: !helperReason, reason: helperReason },
      signIn: { enabled: !signInReason, reason: signInReason, console: consoleSignIn() },
      // Signed in and allowed: may read the modules, use the sandboxes and the helper.
      authenticated: Boolean(session?.access.allowed),
      user: accounts.describe(session),
      ...uiProxyInfo(),
    };
  },

  // Sends a sign-in code to an email.
  "POST /api/auth/start": async (req) => {
    const reason = signInUnavailableReason();
    if (reason) throw Object.assign(new Error(reason), { status: 503 });
    const { email: raw } = await readJson(req);
    if (consoleSignIn() && !consoleSignInAllows(req.headers["x-forwarded-host"] ?? req.headers.host)) {
      throw Object.assign(new Error("This runner has no RESEND_API_KEY, so it only signs in this machine (localhost)."), { status: 403 });
    }
    const { email, code, delivery } = accounts.startSignIn(raw, clientIp(req));
    if (delivery === "email") await mailer.signInCode(email, code);
    else if (delivery === "console") log(`sign-in code for ${email}: ${code}`);
    activity.record(accounts.userByEmail(email)?.id ?? null, "code_sent", null, accounts.userByEmail(email) ? null : { email });
    return { sent: true, email, console: delivery === "console" };
  },

  // Checks the code: signs in, as a new user at the first sign-in.
  "POST /api/auth/verify": async (req, res) => {
    const { email, code } = await readJson(req);
    let user;
    try {
      user = accounts.verifySignIn(email, code);
    } catch (err) {
      if (err.code === "wrong_code") activity.record(accounts.userByEmail(String(email).trim().toLowerCase())?.id ?? null, "code_failed", null, null);
      throw err;
    }
    res.setHeader("set-cookie", sessionCookie(sessionToken(config.sessionSecret, user.id), { secure: isHttps(req) }));
    activity.record(user.id, "sign_in", null, null);
    log(`sign-in for learner ${user.id}`);
    const session = accounts.sessionUser(user.id);
    return { authenticated: session.access.allowed, user: accounts.describe(session) };
  },

  // Name and role. For a user who isn't allowed in, this files their access request.
  "POST /api/auth/profile": async (req) => {
    const session = sessionOf(req);
    if (!session) throw Object.assign(new Error("Sign in first."), { status: 401 });
    const { requested } = accounts.setProfile(session.id, await readJson(req));
    if (requested) {
      log(`access request from learner ${session.id}`);
      await mailer.accessRequested(config.adminEmails, requested, origins(req).site).catch((err) => log(`access request email failed: ${err.message}`));
    }
    const fresh = accounts.sessionUser(session.id);
    return { authenticated: fresh.access.allowed, user: accounts.describe(fresh) };
  },

  "DELETE /api/session": async (req, res) => {
    const id = learnerFromRequest(config.sessionSecret, req);
    if (id && accounts.user(id)) activity.record(id, "sign_out", null, null);
    res.setHeader("set-cookie", clearedSessionCookie({ secure: isHttps(req) }));
    return { authenticated: false };
  },

  // Feedback, from anyone signed in (let in or not): kept, and emailed to FEEDBACK_EMAILS. The
  // email goes out after the answer: the feedback is kept either way.
  "POST /api/feedback": async (req) => {
    const session = sessionOf(req);
    if (!session) throw Object.assign(new Error("Sign in to send feedback."), { status: 401 });
    const fb = feedback.add(session.id, { ...(await readJson(req, 32 * 1024)), userAgent: req.headers["user-agent"] });
    log(`feedback ${fb.id} from learner ${session.id}`);
    mailer
      .feedback(config.feedbackEmails, fb, origins(req).site)
      // Without RESEND_API_KEY it's printed to the console, not sent.
      .then(() => config.resendApiKey && config.feedbackEmails.length && feedback.markEmailed(fb.id))
      .catch((err) => log(`feedback ${fb.id} email failed: ${err.message}`));
    return { ok: true, id: fb.id };
  },

  // --- Progress and activity -----------------------------------------------------------------

  "GET /api/progress": async (req) => {
    const session = requireUser(req);
    return activity.progress(session.id, session.access.cohort?.path);
  },

  // The progress this browser had before the first sign-in: kept, once per user.
  "POST /api/progress/import": async (req) => {
    const session = requireUser(req);
    activity.importProgress(session.id, await readJson(req));
    return activity.progress(session.id, session.access.cohort?.path);
  },

  "POST /api/events": async (req) => {
    const session = requireUser(req);
    const { events } = await readJson(req, 64 * 1024);
    return { recorded: activity.recordFromBrowser(session.id, events) };
  },

  "POST /api/heartbeat": async (req) => {
    const session = requireUser(req);
    const { moduleId } = await readJson(req, 4 * 1024);
    return { ok: activity.heartbeat(session.id, moduleId) };
  },

  // --- The sandbox -----------------------------------------------------------------------------

  "GET /api/sandbox": async (req, _res, url) => {
    const learner = requireLearner(req);
    manager.touch(learner, url.searchParams.get("exercise"));
    return { ...(await manager.describe(learner)), allowance: allowanceOf(learner) };
  },

  "POST /api/sandbox/start": async (req) => {
    const learner = requireLearner(req);
    const allowance = allowanceOf(learner);
    if (allowance.remainingMinutes <= 0) {
      const at = new Date(allowance.freesAt ?? Date.now()).toISOString();
      throw Object.assign(new Error(`You've used today's ${Math.round(allowance.limitMinutes / 60)} hours of sandbox time.`), { status: 429, code: "allowance", freesAt: at });
    }
    manager.clearError(learner);
    const wasCreating = !(await manager.find(learner).catch(() => null));
    const result = manager.ensure(learner, origins(req));
    if (wasCreating) activity.record(learner, "sandbox_create", null, null);
    return result;
  },

  "POST /api/sandbox/reset": async (req) => {
    const learner = requireLearner(req);
    const sandbox = await manager.reset(learner);
    if (sandbox) terminals.forget(sandbox.id);
    activity.record(learner, "sandbox_reset", null, null);
    log(`reset sandbox for learner ${learner}`);
    return { state: "none" };
  },

  "GET /api/sandbox/poll": async (req, _res, url) => {
    const learner = requireLearner(req);
    manager.touch(learner, url.searchParams.get("exercise"));
    const files = (url.searchParams.get("files") ?? "").split(",").filter(Boolean);
    const polled = await manager.poll(learner, files, {
      trips: url.searchParams.get("trips") === "1",
      origins: origins(req),
      exercise: url.searchParams.get("exercise"),
    });
    return { ...polled, allowance: allowanceOf(learner) };
  },

  // How a challenge's choice is going, run in the sandbox's commands terminal.
  "GET /api/sandbox/challenge": async (req, _res, url) => {
    const learner = requireLearner(req);
    return manager.challengeRun(learner, url.searchParams.get("id"), url.searchParams.get("choice"));
  },

  "POST /api/sandbox/llm-mode": async (req) => {
    const learner = requireLearner(req);
    const { mode } = await readJson(req);
    return { llmMode: await manager.setLlmMode(learner, mode) };
  },

  "GET /api/files": async (req, _res, url) => {
    const learner = requireLearner(req);
    const file = url.searchParams.get("path");
    return { path: file, content: await manager.readFile(learner, file) };
  },

  "PUT /api/files": async (req) => {
    const learner = requireLearner(req);
    const { path: file, content } = await readJson(req);
    if (typeof content !== "string") throw Object.assign(new Error("content must be a string"), { status: 400 });
    await manager.writeFile(learner, file, content);
    return { ok: true };
  },

  ...admin.routes,
  ...helper.routes,
  // A question to Ask Temporal is an event (its text isn't kept).
  "POST /api/helper/ask": async (req, res, url) => {
    const learner = activeLearner(req);
    if (learner) activity.record(learner, "helper_question", null, null);
    return helper.routes["POST /api/helper/ask"](req, res, url);
  },
};

async function handleApi(req, res, url) {
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return json(res, 404, { error: "not found" });
  const result = await route(req, res, url);
  if (!res.headersSent) json(res, 200, result);
}

// --- Proxies ------------------------------------------------------------------------------

function proxyError(res, err) {
  const status = err.status ?? 502;
  if (!res.headersSent) {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;background:#16181d;color:#e7ebf2">` +
        `<p>${status === 401 || status === 403 ? "Sign in on the course page first." : `The sandbox isn't reachable right now (${String(err.message).replace(/</g, "&lt;")}).`}</p></body>`,
    );
  } else res.destroy();
}

async function handleConsoleProxy(req, res, url) {
  if (url.pathname === "/sbx/console") {
    res.writeHead(302, { location: `/sbx/console/${url.search}` });
    return res.end();
  }
  let learner;
  try {
    learner = requireLearner(req);
    const base = await manager.previewFor(learner, CONSOLE_PORT);
    const rest = url.pathname.slice("/sbx/console".length) || "/";
    await proxyRequest(req, res, { base, path: `${rest}${url.search}`, mountPrefix: "/sbx/console", ...harnessConsole });
  } catch (err) {
    if (err.name !== "AbortError") proxyError(res, err);
  }
}

const uiProxyServer = http.createServer(async (req, res) => {
  try {
    const learner = requireLearner(req);
    const base = await manager.previewFor(learner, TEMPORAL_UI_PORT);
    await proxyRequest(req, res, { base, path: req.url ?? "/", ...temporalUi });
  } catch (err) {
    if (err.name !== "AbortError") proxyError(res, err);
  }
});

// --- The main server ----------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://course.local");
  try {
    if (url.pathname.startsWith("/llm/v1/")) return await llm(req, res, url.pathname.slice("/llm/v1/".length));
    if (url.pathname === "/sbx/console" || url.pathname.startsWith("/sbx/console/")) return await handleConsoleProxy(req, res, url);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (distDir && (req.method === "GET" || req.method === "HEAD")) return await serveStatic(req, res, url.pathname);
    json(res, 404, { error: "not found" });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) log(`${req.method} ${url.pathname} failed: ${err.stack ?? err.message}`);
    if (!res.headersSent) {
      json(res, status, { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.freesAt ? { freesAt: err.freesAt } : {}) }, err.retryAfter ? { "retry-after": String(err.retryAfter) } : {});
    } else res.end();
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://course.local");
  const lsp = url.pathname === "/api/lsp";
  const name = url.pathname.match(/^\/api\/terminal\/([a-z]+)$/)?.[1];
  let learner;
  try {
    if (!lsp && !TERMINALS.includes(name)) throw Object.assign(new Error("not found"), { status: 404 });
    learner = requireLearner(req);
  } catch (err) {
    socket.end(`HTTP/1.1 ${err.status ?? 400} ${err.message}\r\n\r\n`);
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    // Keeps an idle connection open through proxies (Fly's closes quiet ones).
    const ping = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 25_000);
    ws.on("close", () => clearInterval(ping));
    if (lsp) {
      relayLsp(manager, learner, ws).catch((err) => {
        log(`language server relay failed: ${err.message}`);
        if (ws.readyState === ws.OPEN) ws.close(4001, "unavailable");
      });
      return;
    }
    const cols = Number(url.searchParams.get("cols")) || 100;
    const rows = Number(url.searchParams.get("rows")) || 24;
    terminals.attach(learner, name, ws, { cols, rows }).catch((err) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "status", state: "error", message: err.message }));
        ws.close(4001, "unavailable");
      }
    });
  });
});

server.listen(config.port, config.host, () => {
  log(`course runner on http://${config.host}:${config.port}${distDir ? ` (serving ${distDir})` : ""}`);
  const reason = runtimeUnavailableReason();
  log(reason ? `browser runtime OFF: ${reason}` : `browser runtime on, snapshot ${config.snapshot}, up to ${config.maxSandboxes} sandboxes`);
  if (consoleSignIn()) log("no RESEND_API_KEY: sign-in codes are printed here, and any email may sign in, from this machine only (localhost)");
  else if (!config.resendApiKey) log(`no RESEND_API_KEY: nobody can sign in${config.e2eSignInKey ? " but the e2e tests" : ""}`);
  log(`feedback goes to ${config.feedbackEmails.length ? config.feedbackEmails.join(", ") : "nobody (FEEDBACK_EMAILS is empty): it's only kept"}`);
  log(`database ${config.databasePath}; admins: ${config.adminEmails.length ? config.adminEmails.join(", ") : "none (set ADMIN_EMAILS)"}`);
  if (config.sessionSecretIsEphemeral) log("SESSION_SECRET isn't set: sessions end when the runner restarts");
  if (config.sessionSecretKept) log("SESSION_SECRET isn't set: using course/.session-secret, so restarts keep you signed in, on the same sandbox");
  if (!config.geminiApiKey) log("GEMINI_API_KEY isn't set: sandboxes can only use the scripted model, and Ask Temporal is off");
  else log(`Ask Temporal on (${config.helperModel}), docs from ${config.kapaMcpUrl} ${config.kapaApiKey ? "with the shared KAPA_API_KEY" : "with each learner's own Kapa sign-in"}`);
});
// The sweep: sandbox time, the sandboxes' lifecycle and the allowance, and the model-call counts.
const sweep = createSweep({ manager, accounts, activity, log, enabled: () => Boolean(config.daytonaApiKey) });
setInterval(() => sweep.tick().catch((err) => log(`sweep failed: ${err.message}`)), 60_000).unref();

uiProxyServer.listen(config.uiProxyPort, config.host, () => log(`Temporal UI proxy on http://${config.host}:${config.uiProxyPort}`));
