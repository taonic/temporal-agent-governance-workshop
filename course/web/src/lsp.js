// The editor's language server: hover, go to definition (F12 or Cmd/Ctrl-click), find
// references (Shift-F12), completion, signature help and syntax errors for the exercise's
// Python files. Going to something defined outside the exercise's files (temporalio, a module
// the exercise doesn't open) peeks instead: where it's defined, its signature and its docs,
// at the cursor. Hovering a keyword argument (`start_to_close_timeout=`) explains it, from the
// library's docstrings (the bridge's course/paramDoc), with a button to ask Ask Temporal for
// more, or for anything at all when the docstrings say nothing. It's a
// jedi-language-server in the learner's sandbox, so it sees the workshop's venv (temporalio,
// pydantic, the workshop's own packages); the runner relays it at /api/lsp.
//
// One client per editor. It connects while the sandbox is live and reconnects when the
// connection drops (the sandbox stopped, the runner restarted); a reconnect opens the current
// file again, so the server starts from what's in the editor.
import { pythonLanguage } from "@codemirror/lang-python";
import { syntaxTree } from "@codemirror/language";
import { Prec, StateEffect, StateField } from "@codemirror/state";
import { closeHoverTooltips, EditorView, hoverTooltip, keymap, showTooltip } from "@codemirror/view";
import {
  findReferencesKeymap,
  LSPClient,
  LSPPlugin,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
  Workspace,
} from "@codemirror/lsp-client";

const ROOT = "file:///workshop";

// The language client's own rejections, which no caller handles: when the handshake times out,
// its queued notifications (didOpen…) each reject with it (createLsp reconnects for it); and a
// request the server declines (cancelled, the document changed) rejects with the server's
// JSON-RPC error object, { code, message }, not an Error.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const jsonRpcError = reason && !(reason instanceof Error) && typeof reason.code === "number" && typeof reason.message === "string";
  if (reason?.message === "Request timed out" || jsonRpcError) event.preventDefault();
});

export const fileUri = (path) => `${ROOT}/${path}`;
const pathOf = (uri) => (uri.startsWith(`${ROOT}/`) ? decodeURIComponent(uri.slice(ROOT.length + 1)) : null);
// How a definition's file is shown: a library by its import path, a workshop file by its own.
const shownPath = (uri) => decodeURIComponent(uri.match(/\/site-packages\/(.+)$/)?.[1] ?? pathOf(uri) ?? uri.replace(/^file:\/\//, ""));
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// --- The peek: a definition that can't be opened, shown at the cursor -----------------------

const setPeek = StateEffect.define();
const peekField = StateField.define({
  create: () => null,
  update(peek, tr) {
    for (const effect of tr.effects) if (effect.is(setPeek)) return effect.value;
    return peek && (tr.docChanged || tr.selection) ? null : peek;
  },
  // While it's open, the hover over the same word (which says the same thing) stays hidden.
  provide: (field) => [
    showTooltip.from(field),
    EditorView.editorAttributes.from(field, (peek) => (peek ? { class: "cm-peeking" } : {})),
  ],
});

function peekTooltip(pos, where, docs) {
  return {
    pos,
    above: false,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-lsp-hover-tooltip cm-lsp-documentation cm-lsp-peek";
      dom.innerHTML = `<div class="cm-lsp-peek-where">${where}</div>${docs}`;
      return { dom };
    },
  };
}

// Cmd-click on a Mac, Ctrl-click elsewhere, as in VS Code.
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

// --- Hover, with keyword arguments explained -----------------------------------------------

// `name=` in a call's arguments: the name, where it is, and the call (`workflow.execute_activity`).
function keywordArgAt(state, pos) {
  for (const side of [1, -1]) {
    const node = syntaxTree(state).resolveInner(pos, side);
    if (node.name !== "VariableName" || node.parent?.name !== "ArgList" || node.nextSibling?.name !== "AssignOp") continue;
    const callee = node.parent.parent?.firstChild;
    return {
      from: node.from,
      to: node.to,
      name: state.sliceDoc(node.from, node.to),
      call: callee ? state.sliceDoc(callee.from, callee.to) : "",
      line: state.doc.lineAt(node.from).text.trim(),
    };
  }
  return null;
}

// ask(question, { text, path }) opens Ask Temporal; canAsk() says whether it's on here.
function hoverSource({ ask, canAsk }) {
  return async (view, pos) => {
    const plugin = LSPPlugin.get(view);
    if (!plugin) return null;
    const { client } = plugin;
    const keyword = keywordArgAt(view.state, pos);
    const at = plugin.toPosition(pos);
    client.sync();
    const [hover, param] = await Promise.all([
      client.request("textDocument/hover", { textDocument: { uri: plugin.uri }, position: at }).catch(() => null),
      keyword
        ? client.request("course/paramDoc", { text: view.state.doc.toString(), path: pathOf(plugin.uri), ...at }).catch(() => null)
        : null,
    ]);
    if (!hover?.contents && !keyword) return null;
    const range = hover?.range;
    return {
      pos: keyword?.from ?? (range ? plugin.fromPosition(range.start) : pos),
      end: keyword?.to ?? (range ? plugin.fromPosition(range.end) : pos),
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover-tooltip cm-lsp-documentation";
        dom.innerHTML = hover?.contents ? plugin.docToHTML(hover.contents, "markdown") : "";
        if (param?.doc) {
          const doc = dom.appendChild(document.createElement("div"));
          doc.className = "cm-lsp-param-doc";
          doc.innerHTML = plugin.docToHTML(param.doc, "markdown");
          if (param.source !== param.owner) {
            doc.insertAdjacentHTML("beforeend", `<div class="cm-lsp-param-source">From <code>${escape(param.source)}</code>, which <code>${escape(param.owner)}</code> passes it to.</div>`);
          }
        }
        if (keyword && canAsk()) {
          const button = dom.appendChild(document.createElement("button"));
          button.type = "button";
          button.className = "cm-lsp-ask";
          button.innerHTML = `<span aria-hidden="true">✦</span> ${param?.doc ? "Ask Temporal for more" : `Ask Temporal what <code>${escape(keyword.name)}</code> does`}`;
          button.onmousedown = (event) => event.preventDefault();
          button.onclick = () => {
            view.dispatch({ effects: closeHoverTooltips });
            const call = keyword.call ? ` in \`${keyword.call}(...)\`` : "";
            ask(`What does \`${keyword.name}\`${call} do, and when would I change it?`, { text: keyword.line, path: pathOf(plugin.uri) });
          };
        }
        return { dom };
      },
    };
  };
}

const closePeek = (view) => {
  if (!view.state.field(peekField, false)) return false;
  view.dispatch({ effects: setPeek.of(null) });
  return true;
};

// The editor has one view and swaps its state per file, so a file is open while its tab is
// showing. A definition in another file opens that file's tab when the exercise has one.
class CourseWorkspace extends Workspace {
  files = [];
  #versions = {};

  constructor(client, { openPath, notOpen }) {
    super(client);
    this.openPath = openPath;
    this.notOpen = notOpen;
  }

  #nextVersion(uri) {
    return (this.#versions[uri] = (this.#versions[uri] ?? -1) + 1);
  }

  syncFiles() {
    const updates = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin || plugin.unsyncedChanges.empty) continue;
      updates.push({ changes: plugin.unsyncedChanges, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version = this.#nextVersion(file.uri);
      plugin.clear();
    }
    return updates;
  }

  openFile(uri, languageId, view) {
    this.files = this.files.filter((f) => f.uri !== uri);
    const file = { uri, languageId, version: this.#nextVersion(uri), doc: view.state.doc, view, getView: () => view };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri, view) {
    const file = this.getFile(uri);
    if (!file || file.view !== view) return;
    this.files = this.files.filter((f) => f !== file);
    this.client.didClose(uri);
  }

  // Find references (Shift-F12) lands here for a reference in another file.
  async displayFile(uri) {
    const open = this.getFile(uri);
    if (open) return open.view;
    const path = uri.includes("/site-packages/") ? null : pathOf(uri);
    const view = path ? await this.openPath(path) : null;
    if (!view) this.notOpen(shownPath(uri));
    return view;
  }
}

// F12: jump to the definition when it's in this file or another of the exercise's (opening
// its tab), and peek at it otherwise.
async function goToDefinition(view, workspace) {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return;
  const { client } = plugin;
  const pos = view.state.selection.main.head;
  const at = { textDocument: { uri: plugin.uri }, position: plugin.toPosition(pos) };
  client.sync();
  try {
    const found = await client.request("textDocument/definition", at);
    const loc = Array.isArray(found) ? found[0] : found;
    if (!loc) return;
    const path = loc.uri.includes("/site-packages/") ? null : pathOf(loc.uri);
    const target = loc.uri === plugin.uri ? view : path ? await workspace.openPath(path) : null;
    if (target) {
      const to = plugin.fromPosition(loc.range.start, target.state.doc);
      target.dispatch({ selection: { anchor: to }, scrollIntoView: true, userEvent: "select.definition" });
      return;
    }
    const hover = await client.request("textDocument/hover", at).catch(() => null);
    const docs = hover?.contents ? plugin.docToHTML(hover.contents, "markdown") : "";
    const where = `Defined in <code>${escape(shownPath(loc.uri))}</code>, line ${loc.range.start.line + 1}, which isn't open here.`;
    if (view.state.selection.main.head === pos) view.dispatch({ effects: setPeek.of(peekTooltip(pos, where, docs)) });
  } catch (err) {
    plugin.reportError("Finding the definition failed", err);
  }
}

// ask and canAsk: Ask Temporal, for keyword arguments (see hoverSource).
// openPath(path) shows that file's tab and resolves to the editor view, or to null when the
// exercise has no such file; notOpen(path) says a reference (Shift-F12) is in a file that
// can't be shown. F12 peeks at such a definition instead (goToDefinition).
export function createLsp({ openPath, notOpen, ask, canAsk = () => true }) {
  const client = new LSPClient({
    rootUri: ROOT,
    timeout: 10_000, // jedi's first look at a big module (temporalio's) can take a few seconds
    highlightLanguage: (name) => (/^py/.test(name) ? pythonLanguage : null),
    workspace: (c) => new CourseWorkspace(c, { openPath, notOpen }),
    extensions: [
      serverCompletion(),
      hoverTooltip(hoverSource({ ask, canAsk }), { hideOn: (tr) => tr.docChanged }),
      signatureHelp(),
      serverDiagnostics(),
      keymap.of(findReferencesKeymap),
    ],
  });

  let socket = null;
  let wanted = false;
  let retry = 0;
  let timer = 0;

  function open() {
    clearTimeout(timer);
    if (!wanted || socket) return;
    const handlers = new Set();
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/lsp`);
    socket = ws;
    // The runner says when it has reached the sandbox's server (course/ready); the handshake
    // starts then, so its initialize request doesn't time out while the server starts.
    let ready = false;
    ws.onmessage = (event) => {
      const message = String(event.data);
      if (ready) return handlers.forEach((handler) => handler(message));
      if (!message.includes('"course/ready"')) return;
      ready = true;
      retry = 0;
      client.connect({
        send: (message) => ws.send(message),
        subscribe: (handler) => handlers.add(handler),
        unsubscribe: (handler) => handlers.delete(handler),
      });
      // A handshake that times out (a sandbox busy running a check, say) leaves the client
      // refusing everything until it disconnects: start over, as for a dropped connection.
      client.initializing.catch(() => {
        if (socket === ws) ws.close();
      });
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (ready) client.disconnect();
      if (wanted) timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
  }

  return {
    // The extension for one file's editor state.
    plugin: (path) => [
      client.plugin(fileUri(path), "python"),
      peekField,
      Prec.high(
        keymap.of([
          { key: "F12", preventDefault: true, run: (view) => (goToDefinition(view, client.workspace), true) },
          { key: "Escape", run: closePeek },
        ]),
      ),
      // Ahead of CodeMirror's own Cmd/Ctrl-click, which would add a second cursor.
      Prec.high(
        EditorView.domEventHandlers({
          mousedown(event, view) {
            if (event.button !== 0 || !(isMac ? event.metaKey : event.ctrlKey)) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            event.preventDefault(); // which also keeps the editor from taking focus: give it
            view.focus();
            view.dispatch({ selection: { anchor: pos } });
            goToDefinition(view, client.workspace);
            return true;
          },
        }),
      ),
    ],
    start() {
      wanted = true;
      open();
    },
    stop() {
      wanted = false;
      clearTimeout(timer);
      const ws = socket;
      socket = null;
      ws?.close();
      if (ws) client.disconnect(); // harmless if the handshake never started
    },
  };
}
