// The editor's language server: the browser's /api/lsp WebSocket, relayed to the bridge in
// the learner's sandbox (course/snapshot/lsp_bridge.py) through its preview URL. Each browser
// connection gets its own upstream connection, and so its own server process in the sandbox:
// two tabs never share one server's idea of the open files.
//
// Both sides speak the same thing, one JSON-RPC message per text frame, so this only copies
// frames. Reaching the bridge can take a while (it may need starting), so the relay sends the
// browser a `course/ready` notification once it's through, and the browser's client starts
// the LSP handshake then, rather than timing out its initialize request meanwhile.
import WebSocket from "ws";

import { LSP_PORT } from "./sandboxes.mjs";

const CONNECT_TIMEOUT_MS = 10_000;
const ATTEMPTS = 5;
export const READY = "course/ready";

function open(url) {
  return new Promise((resolve, reject) => {
    const upstream = new WebSocket(url, { headers: { "x-daytona-skip-preview-warning": "true" }, maxPayload: 8 * 1024 * 1024 });
    const timer = setTimeout(() => {
      upstream.terminate();
      reject(new Error("timed out"));
    }, CONNECT_TIMEOUT_MS);
    upstream.once("open", () => {
      clearTimeout(timer);
      resolve(upstream);
    });
    upstream.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Connects to the bridge, starting it if it isn't answering (it may have exited on its own).
async function connect(manager, learner) {
  const url = (await manager.previewFor(learner, LSP_PORT)).replace(/^http/, "ws");
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      return await open(url);
    } catch (err) {
      lastError = err;
      if (attempt === 0) await manager.startLsp(learner).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`The language server isn't answering (${lastError?.message}).`);
}

export async function relayLsp(manager, learner, ws) {
  const waiting = [];
  let upstream = null;
  let closed = false;

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(data.toString());
    else waiting.push(data.toString());
  });
  ws.on("close", () => {
    closed = true;
    upstream?.close();
  });

  upstream = await connect(manager, learner);
  if (closed) return upstream.close();
  for (const message of waiting.splice(0)) upstream.send(message);
  ws.send(JSON.stringify({ jsonrpc: "2.0", method: READY }));
  upstream.on("message", (data) => ws.readyState === ws.OPEN && ws.send(data.toString()));
  upstream.on("close", () => ws.readyState === ws.OPEN && ws.close(4002, "language server closed"));
  upstream.on("error", () => upstream.terminate());
}
