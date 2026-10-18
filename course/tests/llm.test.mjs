// The model passthrough, against a fake upstream.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { llmKey } from "../runner/auth.mjs";
import { createLlmPassthrough } from "../runner/llm.mjs";
import { RateLimiter } from "../runner/ratelimit.mjs";

const config = {
  sessionSecret: "s",
  geminiApiKey: "real-gemini-key",
  llmUpstream: "https://upstream.example/v1beta/openai",
  llmModel: "gemini-test",
  llmTimeoutMs: 5000,
};
const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  const body = JSON.parse(init.body);
  // Echo the request back as SSE, so the test can see exactly what went upstream.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ echo: body })}\n\n`));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};

let server;
let base;
before(async () => {
  const handle = createLlmPassthrough(config, {
    fetchImpl: fakeFetch,
    limiter: new RateLimiter({ perKey: 2, global: 100 }),
  });
  server = http.createServer((req, res) => handle(req, res, req.url.replace(/^\/llm\/v1\//, "")));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/llm/v1`;
});
after(() => server.close());

const key = llmKey(config.sessionSecret, "learner_one-1");
const post = (body, auth = `Bearer ${key}`) =>
  fetch(`${base}/chat/completions`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

test("a bad key is refused, and nothing goes upstream", async () => {
  const res = await post({ model: "gemini-test", messages: [] }, "Bearer nope");
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("another model is refused", async () => {
  const res = await post({ model: "gemini-ultra", messages: [] });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("a good request goes upstream with the real key, unchanged, and streams back", async () => {
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" }, extra_content: { google: { thought_signature: "sig==" } } }] },
  ];
  const res = await post({ model: "gemini-test", stream: true, messages });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /event-stream/);
  const text = await res.text();
  const echoed = JSON.parse(text.split("\n")[0].slice(6)).echo;
  assert.deepEqual(echoed.messages, messages, "extra_content survives the trip");
  const call = calls.at(-1);
  assert.equal(call.url, "https://upstream.example/v1beta/openai/chat/completions");
  assert.equal(call.init.headers.authorization, "Bearer real-gemini-key");
});

test("the per-sandbox rate limit answers 429 with Retry-After", async () => {
  const res = await post({ model: "gemini-test", messages: [] });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
});

test("models lists only the pinned model, and other routes don't exist", async () => {
  const models = await (await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.deepEqual(models.data.map((m) => m.id), ["gemini-test"]);
  const other = await fetch(`${base}/embeddings`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: "{}" });
  assert.equal(other.status, 404);
});
