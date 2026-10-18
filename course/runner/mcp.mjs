// Just enough of an MCP client for the helper: the Streamable HTTP transport, initialize,
// tools/list and tools/call. A reply can come back as JSON or as an SSE stream; both are read
// to the message that answers the request.

export const PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = "McpError";
    this.status = status;
    this.code = code;
  }
}

// The JSON-RPC message with this id, from an SSE body.
async function fromEventStream(response, id) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const event = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          continue;
        }
        if (message.id === id) return message;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new McpError("The MCP server closed the stream without answering.");
}

export class McpClient {
  constructor(url, { token, fetchImpl = fetch, timeoutMs = 30_000, clientName = "temporal-workshop-helper" } = {}) {
    this.url = url;
    this.token = token;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.clientName = clientName;
    this.sessionId = null;
    this.nextId = 1;
  }

  #headers() {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
    };
  }

  async #post(message, signal) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await this.fetch(this.url, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(message),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok && response.status !== 202) {
      const text = await response.text().catch(() => "");
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error_description ?? parsed.error?.message ?? parsed.error ?? detail;
      } catch {
        /* not JSON */
      }
      throw new McpError(`MCP ${message.method}: HTTP ${response.status}${detail ? ` (${detail})` : ""}`, { status: response.status });
    }
    return response;
  }

  async request(method, params, { signal } = {}) {
    const id = this.nextId++;
    const response = await this.#post({ jsonrpc: "2.0", id, method, params }, signal);
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    const type = response.headers.get("content-type") ?? "";
    const message = type.includes("text/event-stream") ? await fromEventStream(response, id) : await response.json();
    if (message.error) throw new McpError(`MCP ${method}: ${message.error.message}`, { code: message.error.code });
    return message.result;
  }

  async notify(method, params, { signal } = {}) {
    const response = await this.#post({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }, signal);
    await response.body?.cancel().catch(() => {});
  }

  async connect({ signal } = {}) {
    const result = await this.request(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: this.clientName, version: "1.0.0" } },
      { signal },
    );
    await this.notify("notifications/initialized", undefined, { signal });
    return result;
  }

  async listTools({ signal } = {}) {
    const tools = [];
    let cursor;
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {}, { signal });
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name, args, { signal } = {}) {
    return this.request("tools/call", { name, arguments: args }, { signal });
  }
}
