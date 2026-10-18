// The model passthrough. Sandboxes call /llm/v1/* with their own key (signed from the
// learner id); this checks it and the rate limits, swaps in the real Gemini key, and relays
// request and reply unchanged. Unchanged matters: Gemini 3 sends each tool call's thought
// signature (`extra_content`) and needs it back on the next turn, which a translating proxy
// can drop. The model is pinned, so a sandbox can't spend the key on a pricier one.
import { Readable } from "node:stream";

import { verifyLlmKey } from "./auth.mjs";
import { RateLimiter } from "./ratelimit.mjs";

const ROUTES = new Set(["POST chat/completions", "GET models"]);

export function createLlmPassthrough(config, { fetchImpl = fetch, limiter } = {}) {
  const limits =
    limiter ?? new RateLimiter({ perKey: config.llmPerSandboxPerMinute, global: config.llmGlobalPerMinute });

  function reply(res, status, message, headers = {}) {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify({ error: { message, type: "course_passthrough" } }));
  }

  return async function handle(req, res, rest) {
    if (!ROUTES.has(`${req.method} ${rest}`)) return reply(res, 404, `Not available here: ${req.method} /${rest}`);
    if (!config.geminiApiKey) return reply(res, 503, "The course runner has no GEMINI_API_KEY.");

    const key = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const learner = verifyLlmKey(config.sessionSecret, key);
    if (!learner) return reply(res, 401, "Unknown key. This endpoint only serves the course's sandboxes.");

    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: config.llmModel, object: "model", owned_by: "course" }] }));
    }

    const limit = limits.take(learner);
    if (!limit.ok) {
      const who = limit.scope === "sandbox" ? "this sandbox" : "the whole workshop";
      return reply(res, 429, `Rate limit for ${who}; retry in ${limit.retryAfterSeconds}s.`, {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply(res, 400, "The request body isn't JSON.");
    }
    if (body.model !== config.llmModel) {
      return reply(res, 400, `This workshop's model is ${config.llmModel} (asked for ${body.model}).`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
    res.on("close", () => controller.abort());
    let upstream;
    try {
      upstream = await fetchImpl(`${config.llmUpstream}/${rest}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: req.headers.accept ?? "application/json",
          authorization: `Bearer ${config.geminiApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      return reply(res, 502, `The model didn't answer: ${err.message}`);
    }

    const headers = { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-cache" };
    res.writeHead(upstream.status, headers);
    if (!upstream.body) {
      clearTimeout(timer);
      return res.end();
    }
    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", () => res.destroy());
    stream.on("end", () => clearTimeout(timer));
    stream.pipe(res);
  };
}
