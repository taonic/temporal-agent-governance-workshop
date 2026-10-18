// The helper: "Ask Temporal". A learner's question goes to Gemini with one tool, a search of
// Temporal's docs through Kapa (kapa.mjs); the model searches, reads, and answers with
// numbered citations, and the answer streams to the page as server-sent events:
//
//   { type: "search", id, query, state: "running" | "done" | "busy" | "failed", count }
//   { type: "sources", sources: [{ n, url, title }] }
//   { type: "delta", text }
//   { type: "done" }
//   { type: "error", message, code? }        code "verify": connect the docs again
//
// It knows where the learner is: the exercise's assignment (read here, from the repo), and the
// code or selection the page attaches.
import fs from "node:fs";
import path from "node:path";

import { plainCookie, seal, unseal } from "./auth.mjs";
import { createDocsSearch, createKapaAuth, DocsUnauthorized } from "./kapa.mjs";
import { RateLimiter } from "./ratelimit.mjs";
import { repoRoot } from "./repo-files.mjs";

const TOKEN_COOKIE = "course_kapa";
// Kapa's tokens are long JWTs, and sealed they're more than one cookie holds: the seal is split
// over course_kapa, course_kapa_1, course_kapa_2. No more, so the request stays under Node's
// 16 KB header limit.
const TOKEN_PARTS = 3;
const PART_SIZE = 3800;
const tokenPart = (i) => (i ? `${TOKEN_COOKIE}_${i}` : TOKEN_COOKIE);
const PENDING_COOKIE = "course_kapa_oauth";
const COOKIE_PATH = "/api/helper";
const TOKEN_PURPOSE = "kapa-token";
const PENDING_PURPOSE = "kapa-oauth";

const MAX_ROUNDS = 4;
const MAX_SEARCHES = 3;
const LIMITS = { turns: 12, turnChars: 6000, question: 4000, code: 14_000, selection: 5000, assignment: 16_000 };

// --- What the model is told ---------------------------------------------------------------

let workshopIntro = null;

// The README up to its architecture: the workshop's pitch and its table of exercises.
function readWorkshopIntro() {
  if (workshopIntro !== null) return workshopIntro;
  try {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    workshopIntro = readme.split(/^## /m).slice(0, 1).join("").replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim().slice(0, 4000);
  } catch {
    workshopIntro = "";
  }
  return workshopIntro;
}

// The assignment as the learner sees it in this mode (the course's mode blocks, as in
// content/build.mjs: browser-only text sits in a comment, local-only text between markers).
export function readAssignment(exerciseId, mode = "browser") {
  if (!/^\d{2}-[a-z0-9-]+$/.test(String(exerciseId ?? ""))) return null;
  const file = path.join(repoRoot, "challenges", exerciseId, "assignment.md");
  let text;
  try {
    text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
  const title = text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? exerciseId;
  text = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--\s*browser\s*\n([\s\S]*?)-->/g, (_, body) => (mode === "browser" ? body : ""))
    .replace(/<!--\s*local\s*-->([\s\S]*?)<!--\s*\/local\s*-->/g, (_, body) => (mode === "local" ? body : ""));
  return { title, text: text.trim().slice(0, LIMITS.assignment) };
}

export function systemPrompt({ assignment, mode }) {
  const parts = [
    `You are "Ask Temporal", the teaching assistant in a hands-on workshop for AI engineers who are new to Temporal. Learners ask you questions while they do the exercises. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
    `How to answer:
- For anything about Temporal (concepts, SDK APIs, the CLI, the Web UI, Temporal Cloud, error messages), call search_temporal_docs first and base your answer on what it returns. Cite the sources you used inline as [1], [2] by their numbers. Never make up a URL or an API.
- One search is usually enough. Search again only if the first one missed; write short, specific queries ("activity retry policy python", not the learner's whole message).
- The workshop is in Python (the temporalio SDK). Write examples in Python unless the learner asks for another language.
- Monty (the sandbox the agent's scripts run in), Dogwood (the policy language and verifier) and the Temporal Agent Harness are part of this workshop, not of Temporal, and the Temporal docs don't cover them. Answer questions about them from the workshop material below, and don't search for them.
- Be a great TA: lead with the answer, then the why. Keep it short (usually under 200 words), concrete, and friendly. Use Markdown: short paragraphs, bullets, and fenced code blocks with a language.
- Don't paste the full solution to the exercise's TODO unprompted. Explain the idea and point to the API first; if the learner asks outright for the code, give it.
- If the docs don't settle it, say what you're unsure of instead of guessing.
- Questions that aren't about Temporal, this workshop or building agents: answer briefly if it's quick, and steer back to the workshop.`,
    `The workshop:\n${readWorkshopIntro()}`,
  ];
  if (assignment) {
    parts.push(
      `The learner is on "${assignment.title}", working ${mode === "local" ? "on their own machine" : "in a browser sandbox (an editor, two terminals, the agent console and the Temporal UI in the page)"}. Its instructions:\n\n<assignment>\n${assignment.text}\n</assignment>`,
    );
  }
  return parts.join("\n\n");
}

const clip = (value, limit) => {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}\n…(cut)` : text;
};

// The conversation for the model: earlier turns as text, and the question with whatever the
// page attached (the step they're on, the learner's file, a selection).
export function conversation(messages, context = {}) {
  const turns = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-LIMITS.turns)
    .map((m) => ({ role: m.role, content: clip(m.content, LIMITS.turnChars) }));
  const last = turns.at(-1);
  if (!last || last.role !== "user") return null;
  last.content = clip(last.content, LIMITS.question);
  const attached = [];
  // Asked from the guide, about the step it's showing.
  const step = typeof context.step?.title === "string" ? context.step.title.trim() : "";
  if (step) attached.push(`They asked this from the instructions' "${clip(step, 200)}" (the step they're on).`);
  const selection = context.selection;
  if (selection?.text) {
    const where = { terminal: "a terminal", editor: `the editor${selection.path ? ` (${selection.path})` : ""}`, instructions: "the instructions" }[selection.source] ?? "the page";
    attached.push(`They selected this in ${where}:\n\`\`\`\n${clip(selection.text, LIMITS.selection)}\n\`\`\``);
  }
  const file = context.file;
  if (file?.path && typeof file.text === "string" && file.text.trim()) {
    const lang = file.path.endsWith(".py") ? "python" : "";
    const what = {
      solution: `The official solution's ${file.path}, which they're peeking at`,
      starter: `The exercise's starting version of ${file.path} (they edit their own copy, which you can't see)`,
    }[file.view] ?? `Their copy of ${file.path}, as it is now`;
    attached.push(`${what}:\n\`\`\`${lang}\n${clip(file.text, LIMITS.code)}\n\`\`\``);
  }
  if (attached.length) last.content = `${last.content}\n\n---\nContext from the page (the learner didn't type this):\n\n${attached.join("\n\n")}`;
  return turns;
}

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search_temporal_docs",
    description:
      "Search Temporal's documentation, SDK references, blog, courses and community answers. Returns the most relevant passages, each numbered with its source. Use it before answering anything about Temporal.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A short, specific search query, e.g. 'workflow update validator python'." } },
      required: ["query"],
    },
  },
};

// --- The model, streamed -------------------------------------------------------------------

// Reads an OpenAI-style SSE stream, passing text on as it comes and collecting tool calls
// whole. Each tool call keeps every field the model sent (Gemini's thought signature rides in
// `extra_content`, and has to go back on the next turn).
export async function readCompletion(response, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls = [];
  const apply = (chunk) => {
    const delta = chunk.choices?.[0]?.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const index = part.index ?? calls.length;
      const call = (calls[index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      for (const [key, value] of Object.entries(part)) {
        if (key === "index") continue;
        if (key === "function") {
          if (value?.name) call.function.name += value.name;
          if (value?.arguments) call.function.arguments += value.arguments;
        } else if (key === "id") call.id = value || call.id;
        else if (value !== undefined && value !== null) call[key] = value;
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        apply(JSON.parse(data));
      } catch {
        /* a partial or odd line */
      }
    }
  }
  return { content, toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` })) };
}

async function upstreamError(response) {
  const text = await response.text().catch(() => "");
  let message = text.slice(0, 300);
  try {
    let parsed = JSON.parse(text);
    if (Array.isArray(parsed)) parsed = parsed[0];
    message = parsed?.error?.message ?? message;
  } catch {
    /* not JSON */
  }
  if (response.status === 429) return "The model is busy right now. Try again in a moment.";
  return `The model didn't answer (HTTP ${response.status}${message ? `: ${message.trim().slice(0, 200)}` : ""}).`;
}

// Sources numbered once per answer, in the order they're found.
class SourceList {
  constructor() {
    this.byKey = new Map();
  }

  add(pages) {
    return pages.map((page) => {
      const key = page.url || page.content.slice(0, 80);
      let entry = this.byKey.get(key);
      if (!entry) {
        entry = { n: this.byKey.size + 1, url: page.url, title: page.title };
        this.byKey.set(key, entry);
      }
      return { ...entry, content: page.content };
    });
  }

  list() {
    return [...this.byKey.values()];
  }
}

// What the model reads back from a search.
export function formatResults(numbered, budget = 18_000) {
  if (!numbered.length) return "No results. Try a different query, or answer from what you know and say the docs didn't cover it.";
  const each = Math.max(1200, Math.floor(budget / numbered.length));
  return numbered.map((p) => `[${p.n}] ${p.title}${p.url ? ` (${p.url})` : ""}\n${clip(p.content.trim(), each)}`).join("\n\n---\n\n");
}

// --- The helper's routes -------------------------------------------------------------------

export function createHelper(config, { learnerOf, siteOrigin, secure, unavailable, fetchImpl = fetch, log = () => {} } = {}) {
  const auth = createKapaAuth({ mcpUrl: config.kapaMcpUrl, fetchImpl });
  const docs = createDocsSearch({ mcpUrl: config.kapaMcpUrl, fetchImpl });
  const questions = new RateLimiter({ perKey: config.helperPerLearnerPerMinute, global: config.helperGlobalPerMinute });
  const searches = new RateLimiter({ perKey: 12, global: config.kapaSearchesPerMinute });
  // Learners' Kapa tokens: in memory, and sealed in a cookie so they outlive a restart.
  const tokens = new Map();
  // Set once the model has refused tool_choice "required" or reasoning_effort.
  let plainRequests = false;

  const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

  function requireLearner(req) {
    const reason = unavailable();
    if (reason) throw fail(503, reason);
    const learner = learnerOf(req);
    if (!learner) throw fail(401, "Enter the workshop's access code first.", { code: "access" });
    return learner;
  }

  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie ?? "").split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    }
    return out;
  }

  function storedToken(req, learner) {
    const known = tokens.get(learner);
    if (known) return known;
    const jar = cookies(req);
    const sealed = Array.from({ length: TOKEN_PARTS }, (_, i) => jar[tokenPart(i)] ?? "").join("");
    const record = unseal(config.sessionSecret, TOKEN_PURPOSE, sealed);
    if (record?.learner !== learner || !record.accessToken) return null;
    tokens.set(learner, record);
    return record;
  }

  // The cookies that keep a token: its parts, and the unused parts cleared.
  function tokenCookies(req, record) {
    const value = seal(config.sessionSecret, TOKEN_PURPOSE, record);
    if (value.length > TOKEN_PARTS * PART_SIZE) {
      log("helper: the Kapa token is too big for the cookies; it lives in memory only, until a restart");
      return [];
    }
    return Array.from({ length: TOKEN_PARTS }, (_, i) => {
      const part = value.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
      return part
        ? plainCookie(tokenPart(i), part, { secure: secure(req), path: COOKIE_PATH, maxAge: 30 * 24 * 3600 })
        : clearCookie(req, tokenPart(i));
    });
  }

  const clearCookie = (req, name) => plainCookie(name, "", { secure: secure(req), path: COOKIE_PATH, maxAge: 0 });

  function forget(req, res, learner) {
    tokens.delete(learner);
    res.setHeader("set-cookie", Array.from({ length: TOKEN_PARTS }, (_, i) => clearCookie(req, tokenPart(i))));
  }

  // A token that works, refreshed if it has to be, or null: the learner connects again.
  async function usableToken(req, res, learner) {
    if (config.kapaApiKey) {
      await docs.ready(config.kapaApiKey);
      return config.kapaApiKey;
    }
    let record = storedToken(req, learner);
    if (!record) return null;
    const refreshNow = async () => {
      record = { ...(await auth.refresh(record)), learner };
      tokens.set(learner, record);
      const kept = tokenCookies(req, record);
      if (kept.length) res.setHeader("set-cookie", kept);
    };
    try {
      if (record.expiresAt && record.expiresAt < Date.now() + 60_000) await refreshNow();
      await docs.ready(record.accessToken);
      return record.accessToken;
    } catch (err) {
      if (!(err instanceof DocsUnauthorized) && !/refresh|token/i.test(err.message)) throw err;
    }
    try {
      await refreshNow();
      await docs.ready(record.accessToken);
      return record.accessToken;
    } catch {
      forget(req, res, learner);
      return null;
    }
  }

  function status(req) {
    const reason = unavailable();
    const learner = reason ? null : learnerOf(req);
    return {
      enabled: !reason,
      reason,
      signedIn: Boolean(learner),
      docs: config.kapaApiKey ? "ready" : learner && storedToken(req, learner) ? "ready" : "connect",
      sharedDocsKey: Boolean(config.kapaApiKey),
      model: config.helperModel,
    };
  }

  // --- Connecting a learner's Kapa account ---------------------------------------------------

  async function connect(req, res, url) {
    const learner = requireLearner(req);
    const back = String(url.searchParams.get("return") ?? "");
    const returnTo = back.startsWith("#/") ? back : "#/";
    const redirectUri = `${siteOrigin(req)}${COOKIE_PATH}/callback`;
    const { url: target, pending } = await auth.begin(redirectUri);
    res.writeHead(302, {
      location: target,
      "cache-control": "no-store",
      "set-cookie": plainCookie(PENDING_COOKIE, seal(config.sessionSecret, PENDING_PURPOSE, { ...pending, learner, returnTo, at: Date.now() }), {
        secure: secure(req),
        path: COOKIE_PATH,
        maxAge: 900,
      }),
    });
    res.end();
  }

  function finishPage(res, { ok, message, returnTo = "#/" }, setCookies = []) {
    const payload = JSON.stringify({ type: "course-helper-connected", ok, message }).replace(/</g, "\\u003c");
    const back = JSON.stringify(`/${returnTo}`).replace(/</g, "\\u003c");
    const text = ok ? "Connected. You can close this window." : `That didn't work: ${message}`;
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "set-cookie": setCookies });
    res.end(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Temporal docs</title>` +
        `<body style="margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#0f1115;color:#e7ebf2">` +
        `<p style="max-width:360px;padding:24px;text-align:center">${text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</p>` +
        `<script>(function(){var m=${payload};try{if(window.opener&&!window.opener.closed){window.opener.postMessage(m,location.origin);window.close();return}}catch(e){}` +
        `${ok ? `location.replace(${back});` : ""}})();</script></body>`,
    );
  }

  async function callback(req, res, url) {
    const pending = unseal(config.sessionSecret, PENDING_PURPOSE, cookies(req)[PENDING_COOKIE]);
    const clear = clearCookie(req, PENDING_COOKIE);
    const learner = learnerOf(req);
    if (!pending || !learner || pending.learner !== learner || Date.now() - pending.at > 15 * 60_000) {
      return finishPage(res, { ok: false, message: "the sign-in expired. Close this window and try again." }, [clear]);
    }
    if (url.searchParams.get("error")) {
      const message = url.searchParams.get("error_description") || url.searchParams.get("error");
      return finishPage(res, { ok: false, message, returnTo: pending.returnTo }, [clear]);
    }
    if (url.searchParams.get("state") !== pending.state || !url.searchParams.get("code")) {
      return finishPage(res, { ok: false, message: "the reply didn't match this sign-in. Try again.", returnTo: pending.returnTo }, [clear]);
    }
    try {
      const record = { ...(await auth.finish(pending, url.searchParams.get("code"))), learner };
      tokens.set(learner, record);
      log(`helper: learner ${learner} connected the Temporal docs`);
      return finishPage(res, { ok: true, returnTo: pending.returnTo }, [clear, ...tokenCookies(req, record)]);
    } catch (err) {
      return finishPage(res, { ok: false, message: err.message, returnTo: pending.returnTo }, [clear]);
    }
  }

  // --- Answering -------------------------------------------------------------------------------

  async function readBody(req, limit = 256 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw fail(413, "That's too much to send at once.");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      throw fail(400, "The request body isn't JSON.");
    }
  }

  async function ask(req, res) {
    const learner = requireLearner(req);
    const body = await readBody(req);
    const context = body.context && typeof body.context === "object" ? body.context : {};
    const turns = conversation(body.messages, context);
    if (!turns) throw fail(400, "Ask a question first.");

    const limit = questions.take(learner);
    if (!limit.ok) {
      throw fail(429, limit.scope === "sandbox" ? `That's a lot of questions at once. Try again in ${limit.retryAfterSeconds}s.` : `Everyone's asking at once. Try again in ${limit.retryAfterSeconds}s.`, {
        retryAfter: limit.retryAfterSeconds,
      });
    }

    const token = await usableToken(req, res, learner).catch((err) => {
      throw fail(502, `The Temporal docs aren't answering (${err.message}).`);
    });
    if (!token) throw fail(409, "Connect the Temporal docs to ask.", { code: "verify" });

    const mode = context.mode === "local" ? "local" : "browser";
    const assignment = context.exercise ? readAssignment(context.exercise, mode) : null;
    const messages = [{ role: "system", content: systemPrompt({ assignment, mode }) }, ...turns];

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 120_000);
    res.on("close", () => controller.abort());
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    const send = (event) => !res.writableEnded && res.write(`data: ${JSON.stringify(event)}\n\n`);
    const ping = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15_000);

    const sources = new SourceList();
    let searchCount = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const lastRound = round === MAX_ROUNDS - 1 || searchCount >= MAX_SEARCHES;
        // Every answer starts from the docs (models, small ones especially, like to skip it);
        // after that, searching again is the model's call.
        const toolChoice = round === 0 ? "required" : lastRound ? "none" : "auto";
        const call = (options) =>
          fetchImpl(`${config.llmUpstream}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${config.geminiApiKey}` },
            body: JSON.stringify({ model: config.helperModel, stream: true, messages, tools: [SEARCH_TOOL], ...options }),
            signal: controller.signal,
          });
        const preferred = { tool_choice: toolChoice, ...(config.helperReasoningEffort && !plainRequests ? { reasoning_effort: config.helperReasoningEffort } : {}) };
        let response = await call(plainRequests ? { tool_choice: toolChoice === "required" ? "auto" : toolChoice } : preferred);
        // A model that won't take "required" or reasoning_effort: ask plainly, from now on.
        if (response.status === 400 && !plainRequests) {
          log(`helper: the model refused the request (${(await upstreamError(response)).slice(0, 160)}); retrying without tool_choice "required" and reasoning_effort`);
          plainRequests = true;
          response = await call({ tool_choice: toolChoice === "required" ? "auto" : toolChoice });
        }
        if (!response.ok) {
          send({ type: "error", message: await upstreamError(response) });
          return;
        }
        const { content, toolCalls } = await readCompletion(response, (text) => send({ type: "delta", text }));
        if (!toolCalls.length) break;

        messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          let query = "";
          try {
            query = String(JSON.parse(call.function.arguments || "{}").query ?? "").trim();
          } catch {
            /* malformed arguments */
          }
          const id = call.id;
          let reply;
          if (call.function.name !== SEARCH_TOOL.function.name || !query) {
            reply = "Unknown tool or empty query. Use search_temporal_docs with a query.";
          } else if (searchCount >= MAX_SEARCHES) {
            reply = "You've searched enough for this question. Answer now from what you have.";
          } else {
            searchCount++;
            send({ type: "search", id, query, state: "running" });
            const hit = docs.cached(query);
            const allowed = hit ? { ok: true } : searches.take(learner);
            if (!allowed.ok) {
              send({ type: "search", id, query, state: "busy" });
              reply = "The docs search is busy right now (rate limit). Tell the learner you couldn't check the docs this time, and answer carefully from what you know.";
            } else {
              try {
                const { pages } = hit ? { pages: hit } : await docs.search(token, query, { signal: controller.signal });
                const numbered = sources.add(pages);
                send({ type: "search", id, query, state: "done", count: numbered.length });
                send({ type: "sources", sources: sources.list() });
                reply = formatResults(numbered);
              } catch (err) {
                if (err instanceof DocsUnauthorized) {
                  forgetQuietly(learner);
                  send({ type: "error", message: "Your Temporal docs connection expired. Connect again to keep asking.", code: "verify" });
                  return;
                }
                if (controller.signal.aborted) throw err;
                send({ type: "search", id, query, state: "failed" });
                const busy = /rate limit/i.test(err.message);
                reply = busy
                  ? "The docs search hit its rate limit. Tell the learner you couldn't check the docs this time, and answer carefully from what you know."
                  : `The search failed (${err.message}). Answer carefully from what you know, and say you couldn't check the docs.`;
              }
            }
          }
          messages.push({ role: "tool", tool_call_id: id, name: call.function.name, content: reply });
        }
      }
      send({ type: "done" });
    } catch (err) {
      if (!controller.signal.aborted || !res.destroyed) {
        send({ type: "error", message: controller.signal.aborted ? "That took too long. Try a narrower question." : `Something went wrong: ${err.message}` });
      }
    } finally {
      clearTimeout(deadline);
      clearInterval(ping);
      res.end();
    }
  }

  // A token Kapa refused mid-answer: dropped from memory (the cookie goes on the next request).
  function forgetQuietly(learner) {
    tokens.delete(learner);
  }

  return {
    routes: {
      "GET /api/helper": async (req) => status(req),
      "GET /api/helper/connect": connect,
      "GET /api/helper/callback": callback,
      "DELETE /api/helper/connect": async (req, res) => {
        const learner = requireLearner(req);
        forget(req, res, learner);
        return { docs: config.kapaApiKey ? "ready" : "connect" };
      },
      "POST /api/helper/ask": ask,
    },
  };
}
