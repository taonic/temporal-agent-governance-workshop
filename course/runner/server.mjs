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

import {
  clearedSessionCookie,
  codeMatches,
  codeMatchesAny,
  learnerFromRequest,
  newLearnerId,
  sessionCookie,
  sessionToken,
} from "./auth.mjs";
import { config, helperUnavailableReason, openAccess, openAccessAllows, runtimeUnavailableReason } from "./config.mjs";
import { createHelper } from "./helper.mjs";
import { createLlmPassthrough } from "./llm.mjs";
import { relayLsp } from "./lsp.mjs";
import { harnessConsole, proxyRequest, temporalUi } from "./proxy.mjs";
import { CONSOLE_PORT, SandboxManager, TEMPORAL_UI_PORT } from "./sandboxes.mjs";
import { TERMINALS, TerminalHub } from "./terminals.mjs";

const manager = new SandboxManager(config);
const terminals = new TerminalHub(manager);
const llm = createLlmPassthrough(config);
const distDir = config.distDir ? path.resolve(config.distDir) : null;

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

const helper = createHelper(config, {
  learnerOf: (req) => learnerFromRequest(config.sessionSecret, req),
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

function requireLearner(req) {
  const reason = runtimeUnavailableReason();
  if (reason) throw Object.assign(new Error(reason), { status: 503 });
  const learner = learnerFromRequest(config.sessionSecret, req);
  if (!learner) throw Object.assign(new Error("Enter the workshop's access code first."), { status: 401 });
  return learner;
}

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
    const learner = learnerFromRequest(config.sessionSecret, req);
    return {
      runtime: { enabled: !reason, reason, codeRequired: config.accessCodes.length > 0 },
      helper: { enabled: !helperReason, reason: helperReason },
      // A session is good for whichever of the sandboxes and the helper is on.
      authenticated: (!reason || !helperReason) && Boolean(learner),
      ...uiProxyInfo(),
    };
  },

  "POST /api/session": async (req, res) => {
    const reason = runtimeUnavailableReason();
    if (reason && helperUnavailableReason()) throw Object.assign(new Error(reason), { status: 503 });
    const { code } = await readJson(req);
    if (config.accessCodes.length && !codeMatchesAny(config.accessCodes, code)) {
      throw Object.assign(new Error("That isn't this workshop's access code."), { status: 403 });
    }
    if (!config.accessCodes.length && !openAccessAllows(req.headers["x-forwarded-host"] ?? req.headers.host)) {
      throw Object.assign(new Error("This runner has no access code, so it only opens to this machine (localhost)."), { status: 403 });
    }
    const learner = learnerFromRequest(config.sessionSecret, req) ?? newLearnerId();
    res.setHeader("set-cookie", sessionCookie(sessionToken(config.sessionSecret, learner), { secure: isHttps(req) }));
    log(`session for learner ${learner}`);
    return { authenticated: true };
  },

  "DELETE /api/session": async (req, res) => {
    res.setHeader("set-cookie", clearedSessionCookie({ secure: isHttps(req) }));
    return { authenticated: false };
  },

  "GET /api/sandbox": async (req, _res, url) => {
    const learner = requireLearner(req);
    manager.touch(learner, url.searchParams.get("exercise"));
    return manager.describe(learner);
  },

  "POST /api/sandbox/start": async (req) => {
    const learner = requireLearner(req);
    manager.clearError(learner);
    return manager.ensure(learner, origins(req));
  },

  "POST /api/sandbox/reset": async (req) => {
    const learner = requireLearner(req);
    const sandbox = await manager.reset(learner);
    if (sandbox) terminals.forget(sandbox.id);
    log(`reset sandbox for learner ${learner}`);
    return { state: "none" };
  },

  "GET /api/sandbox/poll": async (req, _res, url) => {
    const learner = requireLearner(req);
    manager.touch(learner, url.searchParams.get("exercise"));
    const files = (url.searchParams.get("files") ?? "").split(",").filter(Boolean);
    return manager.poll(learner, files, {
      trips: url.searchParams.get("trips") === "1",
      origins: origins(req),
      exercise: url.searchParams.get("exercise"),
    });
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

  "GET /api/admin/sandboxes": async (req) => {
    if (!config.instructorCode || !codeMatches(config.instructorCode, req.headers["x-instructor-code"])) {
      throw Object.assign(new Error("Instructor code required (x-instructor-code)."), { status: 403 });
    }
    return { max: config.maxSandboxes, sandboxes: await manager.listAll() };
  },

  ...helper.routes,
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
        `<p>${status === 401 ? "Enter the workshop's access code on the course page first." : `The sandbox isn't reachable right now (${String(err.message).replace(/</g, "&lt;")}).`}</p></body>`,
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
      json(res, status, { error: err.message, ...(err.code ? { code: err.code } : {}) }, err.retryAfter ? { "retry-after": String(err.retryAfter) } : {});
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
  if (openAccess() && config.allowOpenAccess) log("WARNING: ALLOW_OPEN_ACCESS=1, so anyone who can reach this runner can create sandboxes");
  else if (openAccess()) log("no ACCESS_CODE: open to this machine only (requests to localhost)");
  if (config.sessionSecretIsEphemeral) log("SESSION_SECRET isn't set: sessions end when the runner restarts");
  if (config.sessionSecretKept) log("SESSION_SECRET isn't set: using course/.session-secret, so restarts keep you signed in, on the same sandbox");
  if (!config.geminiApiKey) log("GEMINI_API_KEY isn't set: sandboxes can only use the scripted model, and Ask Temporal is off");
  else log(`Ask Temporal on (${config.helperModel}), docs from ${config.kapaMcpUrl} ${config.kapaApiKey ? "with the shared KAPA_API_KEY" : "with each learner's own Kapa sign-in"}`);
});
uiProxyServer.listen(config.uiProxyPort, config.host, () => log(`Temporal UI proxy on http://${config.host}:${config.uiProxyPort}`));
