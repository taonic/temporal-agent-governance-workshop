// Temporal's docs, through Kapa's hosted MCP server (https://temporal.mcp.kapa.ai): the
// helper's one source of truth about Temporal.
//
// The public server asks each person to prove they're human once, with GitHub or Google
// (OAuth 2.1: dynamic client registration, PKCE). So each learner connects their own account,
// and Kapa's per-user limits are theirs. An instructor with a Kapa API key for the project can
// set KAPA_API_KEY instead, and nobody has to connect anything.
//
// Kapa only retrieves: its search tool returns ranked chunks of the docs (a source URL and
// Markdown). The helper's model writes the answer from them.
import crypto from "node:crypto";

import { McpClient, McpError } from "./mcp.mjs";

const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

export function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// --- OAuth ------------------------------------------------------------------------------------

export function createKapaAuth({ mcpUrl, fetchImpl = fetch, clientName = "Temporal workshop helper" }) {
  let metadata = null;
  const clients = new Map(); // redirect URI -> { clientId, clientSecret }

  async function getJson(url) {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  // The protected resource names its authorization server, whose metadata sits at the
  // RFC 8414 well-known path (inserted before the issuer's path).
  async function discover() {
    if (metadata) return metadata;
    const resource = new URL(mcpUrl);
    const prm = await getJson(new URL("/.well-known/oauth-protected-resource", resource).href);
    const issuer = new URL(prm.authorization_servers?.[0] ?? resource.origin);
    const path = issuer.pathname.replace(/\/$/, "");
    const candidates = [
      `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
      `${issuer.origin}${path}/.well-known/oauth-authorization-server`,
      `${issuer.origin}/.well-known/openid-configuration${path}`,
    ];
    let lastError;
    for (const url of candidates) {
      try {
        metadata = { ...(await getJson(url)), resource: prm.resource ?? mcpUrl };
        return metadata;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Couldn't find Kapa's authorization server: ${lastError?.message}`);
  }

  async function client(redirectUri) {
    const known = clients.get(redirectUri);
    if (known) return known;
    const meta = await discover();
    const response = await fetchImpl(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Kapa didn't register the helper: HTTP ${response.status}`);
    const registered = await response.json();
    const result = { clientId: registered.client_id, clientSecret: registered.client_secret ?? "" };
    clients.set(redirectUri, result);
    return result;
  }

  // Where to send the learner, and what the callback needs to finish (kept sealed in a cookie).
  async function begin(redirectUri) {
    const meta = await discover();
    const { clientId, clientSecret } = await client(redirectUri);
    const { verifier, challenge } = pkcePair();
    const state = base64url(crypto.randomBytes(16));
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: (meta.scopes_supported ?? ["openid"]).includes("openid") ? "openid" : "",
      resource: meta.resource,
    }).toString();
    return { url: url.href, pending: { state, verifier, redirectUri, clientId, clientSecret } };
  }

  async function token(params) {
    const meta = await discover();
    const response = await fetchImpl(meta.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ ...params, resource: meta.resource }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(`Kapa didn't issue a token: ${data.error_description ?? data.error ?? `HTTP ${response.status}`}`);
    }
    return data;
  }

  const record = (data, { clientId, clientSecret }, previous = {}) => ({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous.refreshToken ?? null,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
    clientId,
    clientSecret,
  });

  async function finish(pending, code) {
    const data = await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      client_id: pending.clientId,
      client_secret: pending.clientSecret,
    });
    return record(data, pending);
  }

  async function refresh(previous) {
    if (!previous?.refreshToken) throw new Error("No refresh token.");
    const data = await token({
      grant_type: "refresh_token",
      refresh_token: previous.refreshToken,
      client_id: previous.clientId,
      client_secret: previous.clientSecret,
    });
    return record(data, previous, previous);
  }

  return { discover, begin, finish, refresh };
}

// --- Search -----------------------------------------------------------------------------------

// The docs a search returned, one entry per page: { url, title, content }. Kapa's structured
// results are a list of { source_url, content } chunks; text results are read as JSON when they
// are, and kept as one untitled source when they aren't.
export function parseSearchResult(result) {
  const chunks = [];
  const take = (item) => {
    if (!item || typeof item !== "object") return;
    const url = item.source_url ?? item.url ?? item.source ?? "";
    const content = item.content ?? item.text ?? item.chunk ?? "";
    if (content || url) chunks.push({ url: String(url), title: item.title ? String(item.title) : "", content: String(content) });
  };
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(take);
    else if (value && typeof value === "object") {
      const list = Object.values(value).find(Array.isArray);
      if (list) list.forEach(take);
      else take(value);
    }
  };
  if (result?.structuredContent) walk(result.structuredContent);
  if (!chunks.length) {
    for (const part of result?.content ?? []) {
      if (part.type !== "text" || !part.text) continue;
      try {
        walk(JSON.parse(part.text));
      } catch {
        chunks.push({ url: "", title: "", content: part.text });
      }
    }
  }
  const pages = new Map();
  for (const chunk of chunks) {
    const key = chunk.url || `#${pages.size}`;
    const page = pages.get(key);
    if (page) page.content += `\n\n${chunk.content}`;
    else pages.set(key, { url: chunk.url, title: chunk.title || titleOf(chunk), content: chunk.content });
  }
  return [...pages.values()];
}

// A page's title: its first heading, or its URL's last segment, made readable.
export function titleOf({ url, content }) {
  const heading = String(content ?? "").match(/^#{1,3}\s+(.+?)\s*#*\s*$/m)?.[1];
  if (heading) return heading.replace(/[*_`]/g, "").slice(0, 120);
  try {
    const { hostname, pathname, hash } = new URL(url);
    const segment = decodeURIComponent((hash.slice(1) || pathname.split("/").filter(Boolean).pop() || hostname).replace(/[-_]+/g, " "));
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  } catch {
    return "Temporal docs";
  }
}

// The search tool and the name of its query argument, from the server's tool list.
export function pickSearchTool(tools) {
  const tool =
    tools.find((t) => /^search_.*knowledge_sources$/.test(t.name)) ??
    tools.find((t) => /search/i.test(t.name)) ??
    null;
  if (!tool) return null;
  const props = tool.inputSchema?.properties ?? {};
  const arg = "query" in props ? "query" : (tool.inputSchema?.required ?? []).find((k) => props[k]?.type === "string") ?? "query";
  return { name: tool.name, arg };
}

export class DocsUnauthorized extends Error {
  constructor(message = "Connect the Temporal docs first.") {
    super(message);
    this.name = "DocsUnauthorized";
  }
}

// Searches, shared by every learner: sessions with the MCP server by token, and results by
// query (the docs are public, and a room of learners asks the same questions).
export function createDocsSearch({ mcpUrl, fetchImpl = fetch, cacheTtlMs = 30 * 60_000, now = () => Date.now() }) {
  const sessions = new Map(); // token hash -> { client, tool, at }
  const cache = new Map(); // normalized query -> { at, pages }
  const SESSION_TTL = 20 * 60_000;
  const hash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

  async function session(token, { signal, fresh = false } = {}) {
    const key = hash(token);
    const known = sessions.get(key);
    if (known && !fresh && now() - known.at < SESSION_TTL) return known;
    const client = new McpClient(mcpUrl, { token, fetchImpl });
    try {
      await client.connect({ signal });
      const tool = pickSearchTool(await client.listTools({ signal }));
      if (!tool) throw new Error("The Temporal docs server has no search tool.");
      const entry = { client, tool, at: now() };
      sessions.set(key, entry);
      if (sessions.size > 500) sessions.delete(sessions.keys().next().value);
      return entry;
    } catch (err) {
      sessions.delete(key);
      if (err instanceof McpError && (err.status === 401 || err.status === 403)) throw new DocsUnauthorized();
      throw err;
    }
  }

  function cached(query) {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = cache.get(key);
    return { key, pages: hit && now() - hit.at < cacheTtlMs ? hit.pages : null };
  }

  async function search(token, query, { signal } = {}) {
    const { key, pages: hit } = cached(query);
    if (hit) return { pages: hit, cached: true };
    let entry = await session(token, { signal });
    let result;
    try {
      result = await entry.client.callTool(entry.tool.name, { [entry.tool.arg]: query }, { signal });
    } catch (err) {
      if (err instanceof McpError && (err.status === 401 || err.status === 403)) {
        sessions.delete(hash(token));
        throw new DocsUnauthorized();
      }
      // A session the server forgot: start a new one, once.
      if (err instanceof McpError && (err.status === 404 || err.status === 400)) {
        entry = await session(token, { signal, fresh: true });
        result = await entry.client.callTool(entry.tool.name, { [entry.tool.arg]: query }, { signal });
      } else throw err;
    }
    if (result?.isError) {
      const message = (result.content ?? []).map((p) => p.text).filter(Boolean).join(" ") || "The search failed.";
      throw new Error(message);
    }
    const pages = parseSearchResult(result);
    cache.set(key, { at: now(), pages });
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return { pages, cached: false };
  }

  // Checks a token works (and warms its session) before an answer starts streaming.
  async function ready(token, { signal } = {}) {
    await session(token, { signal });
  }

  return { search, ready, cached: (query) => cached(query).pages };
}
