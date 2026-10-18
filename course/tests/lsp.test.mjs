// The language server relay, between a fake browser and a fake bridge.
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { after, before, test } from "node:test";

import WebSocket, { WebSocketServer } from "ws";

import { READY, relayLsp } from "../runner/lsp.mjs";

let bridgeServer; // the sandbox's bridge: echoes each message back, tagged
let bridgeUrl;
let relay; // the runner's /api/lsp
let relayUrl;
let starts = 0;
let bridgeUp = true;

const manager = {
  previewFor: async () => bridgeUrl,
  startLsp: async () => {
    starts += 1;
    bridgeUp = true;
  },
};

before(async () => {
  bridgeServer = http.createServer();
  const bridge = new WebSocketServer({ noServer: true });
  bridgeServer.on("upgrade", (req, socket, head) => {
    if (!bridgeUp) return socket.destroy();
    bridge.handleUpgrade(req, socket, head, (ws) => ws.on("message", (data) => ws.send(`echo:${data}`)));
  });
  await new Promise((resolve) => bridgeServer.listen(0, "127.0.0.1", resolve));
  bridgeUrl = `http://127.0.0.1:${bridgeServer.address().port}`;

  const relayServer = http.createServer();
  const wss = new WebSocketServer({ server: relayServer });
  wss.on("connection", (ws) => relayLsp(manager, "learner-1", ws).catch(() => ws.close(4001)));
  await new Promise((resolve) => relayServer.listen(0, "127.0.0.1", resolve));
  relayUrl = `ws://127.0.0.1:${relayServer.address().port}`;
  relay = relayServer;
});

after(() => {
  bridgeServer.close();
  relay.close();
});

async function talk(messages) {
  const ws = new WebSocket(relayUrl);
  const replies = [];
  ws.on("message", (data) => replies.push(String(data)));
  await once(ws, "open");
  // Sent before the relay has reached the bridge: they wait, in order.
  for (const message of messages) ws.send(message);
  for (let i = 0; i < 300 && replies.length <= messages.length; i++) await new Promise((r) => setTimeout(r, 20));
  ws.close();
  return replies;
}

test("relays messages both ways, keeping what arrives before the bridge is reached", async () => {
  const ready = JSON.stringify({ jsonrpc: "2.0", method: READY });
  assert.deepEqual(await talk(['{"id":1}', '{"id":2}']), [ready, 'echo:{"id":1}', 'echo:{"id":2}']);
  assert.equal(starts, 0);
});

test("starts the bridge when it isn't answering", async () => {
  bridgeUp = false;
  assert.deepEqual((await talk(['{"id":3}'])).slice(1), ['echo:{"id":3}']);
  assert.equal(starts, 1);
});
