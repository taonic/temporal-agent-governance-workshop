// The browser's terminals: each learner's sandbox has two Daytona PTY sessions, "worker" and
// "commands". The runner holds one connection to each and fans it out to every open tab,
// replaying recent output to a tab that (re)attaches. The PTYs live in the sandbox, so a
// runner restart only loses that replay buffer.
//
// Browser protocol: text frames are JSON, {type: "input", data} or {type: "resize", cols,
// rows}; the runner sends raw output as binary frames, and JSON for {type: "status", ...}.
import { sandboxRepo } from "./repo-files.mjs";

export const TERMINALS = ["worker", "commands"];
const BUFFER_BYTES = 256 * 1024;
const IDLE_DISCONNECT_MS = 10 * 60_000;

export class TerminalHub {
  constructor(manager) {
    this.manager = manager;
    this.terms = new Map(); // `${sandboxId}:${name}` -> term
  }

  async attach(learner, name, ws, { cols = 100, rows = 24 } = {}) {
    if (!TERMINALS.includes(name)) throw new Error(`No terminal called ${name}.`);
    const sandbox = await this.manager.sandboxFor(learner);
    const key = `${sandbox.id}:${name}`;
    let term = this.terms.get(key);
    if (!term) {
      term = { key, name, sandbox, handle: null, opening: null, chunks: [], bytes: 0, clients: new Set(), idleTimer: null };
      this.terms.set(key, term);
    }
    clearTimeout(term.idleTimer);
    term.clients.add(ws);

    const send = (message) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(message));
    // Listen before the PTY is open: input sent meanwhile waits for it instead of being lost.
    ws.on("message", async (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        if (message.type === "input" && typeof message.data === "string") {
          if (!term.handle) await this.#open(term, { cols, rows });
          await term.handle.sendInput(message.data);
        } else if (message.type === "resize" && message.cols > 0 && message.rows > 0) {
          cols = Math.min(500, message.cols);
          rows = Math.min(200, message.rows);
          await term.handle?.resize(cols, rows);
        }
      } catch (err) {
        send({ type: "status", state: "error", message: err.message });
      }
    });
    ws.on("close", () => {
      term.clients.delete(ws);
      if (term.clients.size === 0) {
        term.idleTimer = setTimeout(() => this.#disconnect(term), IDLE_DISCONNECT_MS);
      }
    });

    for (const chunk of term.chunks) ws.send(chunk);
    try {
      await this.#open(term, { cols, rows });
      send({ type: "status", state: "connected" });
    } catch (err) {
      send({ type: "status", state: "error", message: err.message });
    }
  }

  #broadcast(term, data) {
    for (const client of term.clients) if (client.readyState === client.OPEN) client.send(data);
  }

  #record(term, buffer) {
    term.chunks.push(buffer);
    term.bytes += buffer.length;
    while (term.bytes > BUFFER_BYTES && term.chunks.length > 1) term.bytes -= term.chunks.shift().length;
    this.#broadcast(term, buffer);
  }

  async #open(term, { cols, rows }) {
    if (term.handle) return term.handle;
    if (!term.opening) {
      term.opening = (async () => {
        const proc = term.sandbox.process;
        const onData = (data) => this.#record(term, Buffer.from(data));
        let existing = null;
        try {
          existing = (await proc.listPtySessions()).find((s) => s.id === term.name && s.active);
        } catch {
          /* none yet */
        }
        const handle = existing
          ? await proc.connectPty(term.name, { onData })
          : await proc.createPty({ id: term.name, cwd: sandboxRepo, cols, rows, envs: { TERM: "xterm-256color" }, onData });
        await handle.waitForConnection();
        if (existing) await handle.resize(cols, rows).catch(() => {});
        term.handle = handle;
        handle
          .wait()
          .then(({ exitCode } = {}) => {
            if (term.handle !== handle) return;
            term.handle = null;
            this.#record(term, Buffer.from(`\r\n\x1b[2m[the ${term.name} terminal closed${exitCode != null ? ` (exit ${exitCode})` : ""}; press Enter for a new one]\x1b[0m\r\n`));
            for (const client of term.clients) {
              if (client.readyState === client.OPEN) client.send(JSON.stringify({ type: "status", state: "closed" }));
            }
          })
          .catch(() => {
            if (term.handle === handle) term.handle = null;
          });
        return handle;
      })().finally(() => {
        term.opening = null;
      });
    }
    return term.opening;
  }

  async #disconnect(term) {
    const handle = term.handle;
    term.handle = null;
    this.terms.delete(term.key);
    await handle?.disconnect().catch(() => {});
  }

  // A deleted or restarted sandbox's PTYs are gone: drop the connections and their output.
  forget(sandboxId) {
    for (const term of [...this.terms.values()]) {
      if (!term.key.startsWith(`${sandboxId}:`)) continue;
      for (const client of term.clients) client.close(4000, "sandbox gone");
      this.#disconnect(term);
    }
  }
}
