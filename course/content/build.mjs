// Builds the course site's content from the workshop itself, so the site is never a second
// copy of it:
//
//   challenges/NN-*/assignment.md   the exercises (Instruqt frontmatter: title, teaser, timelimit)
//   README.md                       the home page (its intro and architecture) and the setup page
//   starter/, solutions/chNN/       the editor's starter and solution views
//
// Writes course/web/src/generated/course-data.json, and copies the files the content links
// to under docs/ into course/web/public/content/.
//
// Assignments carry two kinds of mode block, so one file serves GitHub, Instruqt and both
// modes of the site:
//
//   <!-- browser
//   Only in the browser course. Inside a comment, so GitHub and Instruqt don't show it.
//   -->
//   <!-- local -->Only when running locally (and on GitHub and Instruqt).<!-- /local -->
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import MarkdownIt from "markdown-it";
import YAML from "yaml";

import { tourRange } from "../web/src/tourRange.js";
import { ruleBlock, ruleId } from "../web/src/snippets.js";
import { EXERCISES, WORKER_COMMAND } from "./exercises.mjs";

hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);

const courseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(courseDir, "..");
const outFile = path.join(courseDir, "web/src/generated/course-data.json");
const publicContent = path.join(courseDir, "web/public/content");

// Where repo links point when they can't be shown on the site. Unset: they render as text.
const repoUrl = (process.env.COURSE_REPO_URL ?? "").replace(/\/$/, "");

const MODES = ["browser", "local"];

// Inline code that's a command to run as it stands: no <placeholder> to fill in first.
export function isInlineCommand(text) {
  return /^(?:\w+=\S+\s+)*(?:uv run |temporal |\.\/challenges\/|cat )/.test(text) && !/[<>]/.test(text);
}

// "Stop the worker (Ctrl-C)", "restart the worker", "start the travel agent's worker", "Start
// the worker again"…
export const WORKER_PHRASE =
  /\b(?:(?:re)?start|stop)(?:s|ping|ing)? (?:the|your) (?:(?:hello|travel agent's|agent's) )?worker(?: again)?(?: \(Ctrl-C\))?/gi;
// `uv run hello-start SFO JFK`: in the browser, a trip button, filled in by the page, which
// knows the trip's workflow (ExerciseInstructions, with tripView in store.js).
export const HELLO_START = /^uv run hello-start ([A-Za-z]{3}) ([A-Za-z]{3})$/;
function tripButton(command) {
  const [, origin, destination] = command.match(HELLO_START).map((v) => v.toUpperCase());
  return (
    `<span class="trip-toggle" data-trip="${origin} ${destination}" role="group" aria-label="The ${origin} → ${destination} trip">` +
    `<span class="tt-dot" aria-hidden="true"></span><span class="tt-label">Trip ${origin} → ${destination}</span></span>`
  );
}

// "Temporal UI", and "UI" in "in the UI": what the instructions say when they send you there.
const TEMPORAL_UI = /\bTemporal UI\b|(?<=\b[Ii]n the )UI\b/g;
// "the console" (the harness's console, at localhost:8000): the Agent UI tab, in the browser.
const CONSOLE = /\bconsole\b(?='s|\b)/g;
// Filled in by the page (ExerciseInstructions), which knows the worker's state.
const WORKER_TOGGLE =
  '<button class="worker-toggle" type="button" data-worker-toggle><span class="wt-dot" aria-hidden="true"></span><span class="wt-label">Worker</span><span class="wt-action"></span></button>';
// After "restart the worker": one click for both, Ctrl-C and start again.
const WORKER_RESTART = WORKER_TOGGLE.replace("data-worker-toggle", "data-worker-toggle data-worker-restart");

// --- Markdown ----------------------------------------------------------------------------

// A block that starts a line is a paragraph of its own; one that starts mid-line is part of
// that line, so it loses its own line breaks.
export function applyMode(markdown, mode) {
  const block = (keep) => (match, body, offset, whole) => {
    const ownLine = offset === 0 || whole[offset - 1] === "\n";
    if (!keep) return ownLine ? "" : match.endsWith("\n") ? "\n" : "";
    return ownLine ? body.replace(/\n?$/, "\n") : body.replace(/\n+$/, "") + (match.endsWith("\n") ? "\n" : "");
  };
  return markdown
    .replace(/<!--\s*browser\s*\n([\s\S]*?)-->\n?/g, block(mode === "browser"))
    .replace(/<!--\s*local\s*-->\n?([\s\S]*?)<!--\s*\/local\s*-->\n?/g, block(mode === "local"));
}

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { meta: {}, body: markdown };
  return { meta: YAML.parse(match[1]) ?? {}, body: markdown.slice(match[0].length) };
}

// Splits at level-2 headings (outside code fences). The preamble loses its `# Title`: the
// page shows the title itself.
export function splitSections(markdown) {
  const preamble = [];
  const sections = [];
  let current = null;
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = !fence && line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1], lines: [line] };
      sections.push(current);
    } else if (current) current.lines.push(line);
    else if (!/^#\s/.test(line)) preamble.push(line);
  }
  return { preamble: preamble.join("\n").trim(), sections };
}

export function sectionKind(title) {
  if (/^\d+\.\s/.test(title)) return "step";
  if (/^check$/i.test(title)) return "check";
  if (/^stretch\b/i.test(title)) return "stretch";
  return "plain";
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The commands in a shell snippet, one per entry: comments dropped, continuations joined.
export function snippetCommands(code) {
  const commands = [];
  let pending = "";
  for (const raw of code.split("\n")) {
    const line = raw.replace(/\s+#\s.*$/, "").trimEnd();
    if (!pending && (!line.trim() || line.trim().startsWith("#"))) continue;
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1).trimEnd()} `;
      continue;
    }
    commands.push((pending + line.trim()).trim());
    pending = "";
  }
  if (pending.trim()) commands.push(pending.trim());
  return commands;
}

// A link to the harness's code on GitHub, at the commit the workshop pins, with lines
// (`…/blob/<commit>/temporal_agent_harness/…py#L321-L335`): the same file is installed in the
// sandbox's .venv, so the browser course opens it there, in the editor.
const HARNESS_LINES =
  /^https:\/\/github\.com\/temporal-community\/temporal-agent-harness\/blob\/([0-9a-f]{40})\/(temporal_agent_harness\/[\w/.-]+\.py)#L(\d+)(?:-L(\d+))?$/;
const HARNESS_SITE = ".venv/lib/python3.13/site-packages/";
// The commit pyproject.toml pins: a link at any other is to code the sandbox doesn't have.
const HARNESS_PIN = fs
  .readFileSync(path.join(repoRoot, "pyproject.toml"), "utf8")
  .match(/temporal-agent-harness = \{ git = "[^"]+", rev = "([0-9a-f]{40})" \}/)?.[1];

const LOCAL_PANES = [
  [/^https?:\/\/localhost:8233(\/.*)?$/, "temporal"],
  [/^https?:\/\/localhost:8000(\/.*)?$/, "console"],
];

function copyToPublic(rel) {
  const src = path.join(repoRoot, rel);
  const dest = path.join(publicContent, rel.replace(/^docs\//, ""));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return `content/${rel.replace(/^docs\//, "")}`;
}

// Resolves a relative link in a markdown file to what the site should do with it.
function resolveRelative(href, sourceFile) {
  const [target, hash = ""] = href.split("#");
  const rel = path.normalize(path.join(path.dirname(sourceFile), target)).split(path.sep).join("/");
  const exercise = rel.match(/^challenges\/([^/]+)\/assignment\.md$/);
  if (exercise) return { href: `#/exercise/${exercise[1]}` };
  if (rel.startsWith("docs/") && fs.existsSync(path.join(repoRoot, rel))) {
    return { href: copyToPublic(rel) + (hash ? `#${hash}` : ""), external: true };
  }
  if (repoUrl) return { href: `${repoUrl}/blob/main/${rel}`, external: true };
  return { text: true, file: rel };
}

const knownFiles = new Set();
function collectFiles(dir = "") {
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["node_modules", "course", "__pycache__"].includes(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collectFiles(rel);
    else knownFiles.add(rel);
  }
}

function createRenderer() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

  // In the browser, a link to #sandbox ([Start my sandbox](#sandbox)) is the sandbox's start
  // button, which the page shows in the sandbox's state (ExerciseInstructions); a link to
  // #workflow/board-sfo-jfk ([open it](#workflow/board-sfo-jfk/query)) opens the latest of
  // exercise 1's workflows whose id starts with that, in the Temporal UI pane, on a tab if one
  // follows (history, pending-activities, query…). #trip/SFO-JFK is short for #workflow/hello-sfo-jfk.
  // Locally, both are just their words.
  md.core.ruler.push("action_links", (state) => {
    for (const block of state.tokens) {
      if (block.type !== "inline") continue;
      const children = [];
      for (let i = 0; i < block.children.length; i++) {
        const token = block.children[i];
        const href = token.type === "link_open" ? token.attrGet("href") ?? "" : "";
        const trip = href.match(/^#trip\/([A-Za-z]{3})-([A-Za-z]{3})(?:\/([a-z-]+))?$/);
        const flow = trip ? [null, `hello-${trip[1]}-${trip[2]}`.toLowerCase(), trip[3]] : href.match(/^#workflow\/([a-z0-9-]+)(?:\/([a-z-]+))?$/);
        if (href !== "#sandbox" && !flow) {
          children.push(token);
          continue;
        }
        const close = block.children.findIndex((t, j) => j > i && t.type === "link_close");
        const label = block.children.slice(i + 1, close).map((t) => t.content).join("");
        const button = new state.Token("html_inline", "", 0);
        button.content =
          state.env.mode !== "browser"
            ? md.utils.escapeHtml(label)
            : flow
              ? `<button class="workflow-link" type="button" data-workflow-open="${flow[1]}-"${flow[2] ? ` data-workflow-tab="${flow[2]}"` : ""} title="Open it in the Temporal UI">${escapeAttr(label)}</button>`
              : `<button class="sandbox-start" type="button" data-sandbox-start>${escapeAttr(label)}</button>`;
        children.push(button);
        i = close;
      }
      block.children = children;
    }
  });

  // In the browser, "Open the link" (the one hello-start prints) opens the workflow of the
  // trip the section just started, in the Temporal UI pane.
  md.core.ruler.push("trip_links", (state) => {
    if (state.env.mode !== "browser") return;
    let trip = null;
    for (const block of state.tokens) {
      const command = block.type === "fence" ? block.content.trim() : null;
      if (command && HELLO_START.test(command)) trip = command.match(HELLO_START).slice(1, 3).join(" ").toUpperCase();
      if (block.type !== "inline" || !trip) continue;
      const children = [];
      for (const token of block.children) {
        if (token.type !== "text" || !token.content.includes("Open the link")) {
          children.push(token);
          continue;
        }
        const [before, ...rest] = token.content.split("Open the link");
        const text = (content) => Object.assign(new state.Token("text", "", 0), { content });
        const link = new state.Token("html_inline", "", 0);
        link.content = `<button class="workflow-link" type="button" data-workflow-open="hello-${trip.replace(" ", "-").toLowerCase()}-" title="Open it in the Temporal UI">Open its workflow</button>`;
        children.push(text(before), link, text(rest.join("Open the link")));
      }
      block.children = children;
    }
  });

  // Links: the local console and Temporal UI open the sandbox's panes; relative links go to
  // the matching page, a copy under content/, the repo, or plain text.
  md.core.ruler.push("course_links", (state) => {
    const { mode, sourceFile } = state.env;
    for (const block of state.tokens) {
      if (block.type !== "inline") continue;
      const stack = [];
      for (const token of block.children) {
        if (token.type === "link_open") {
          const href = token.attrGet("href") ?? "";
          const pane = LOCAL_PANES.find(([re]) => re.test(href));
          const harness = href.match(HARNESS_LINES);
          if (harness && harness[1] !== HARNESS_PIN) {
            throw new Error(`${sourceFile}: a harness link at ${harness[1].slice(0, 7)}, but pyproject.toml pins ${String(HARNESS_PIN).slice(0, 7)}: ${href}`);
          }
          if (pane && mode === "browser") {
            token.attrSet("href", "#");
            token.attrSet("data-pane", pane[1]);
            token.attrSet("data-path", href.match(pane[0])[1] ?? "/");
            stack.push(token);
          } else if (harness && mode === "browser") {
            // Opens in the editor, the lines highlighted; GitHub stays the fallback.
            token.attrSet("target", "_blank");
            token.attrSet("rel", "noopener");
            token.attrSet("class", "code-ref");
            token.attrSet("data-file", `${HARNESS_SITE}${harness[2]}`);
            token.attrSet("data-lines", `${harness[3]}-${harness[4] ?? harness[3]}`);
            stack.push(token);
          } else if (/^[a-z]+:/i.test(href)) {
            token.attrSet("target", "_blank");
            token.attrSet("rel", "noopener");
            stack.push(token);
          } else if (href.startsWith("#")) {
            stack.push(token);
          } else {
            const resolved = resolveRelative(href, sourceFile);
            if (resolved.text) {
              token.tag = "span";
              token.attrs = [["class", "repo-ref"], ["title", resolved.file]];
            } else {
              token.attrSet("href", resolved.href);
              if (resolved.external) {
                token.attrSet("target", "_blank");
                token.attrSet("rel", "noopener");
              }
            }
            stack.push(token);
          }
        } else if (token.type === "link_close") {
          const open = stack.pop();
          if (open) token.tag = open.tag;
        } else if (token.type === "image") {
          const src = token.attrGet("src") ?? "";
          if (!/^[a-z]+:/i.test(src)) {
            const rel = path.normalize(path.join(path.dirname(sourceFile), src)).split(path.sep).join("/");
            if (fs.existsSync(path.join(repoRoot, rel))) token.attrSet("src", copyToPublic(rel));
          }
        }
      }
    }
  });

  // In the browser, "Temporal UI" in prose (and "in the UI") opens the Temporal UI pane, so
  // wherever the instructions send you to look at it, it's a click away. Not in headings, code
  // or links.
  md.core.ruler.push("temporal_ui_links", (state) => {
    if (state.env.mode !== "browser") return;
    state.tokens.forEach((block, i) => {
      if (block.type !== "inline" || !block.children || state.tokens[i - 1]?.type === "heading_open") return;
      const children = [];
      let insideLink = 0;
      for (const token of block.children) {
        if (token.type === "link_open") insideLink++;
        if (token.type === "link_close") insideLink--;
        if (token.type !== "text" || insideLink || !TEMPORAL_UI.test(token.content)) {
          children.push(token);
          continue;
        }
        TEMPORAL_UI.lastIndex = 0;
        let last = 0;
        for (const match of token.content.matchAll(TEMPORAL_UI)) {
          const before = new state.Token("text", "", 0);
          before.content = token.content.slice(last, match.index);
          const link = new state.Token("html_inline", "", 0);
          link.content = `<a href="#" class="pane-ref" data-pane="temporal" data-path="/" title="Open the Temporal UI beside the instructions">${match[0]}</a>`;
          children.push(before, link);
          last = match.index + match[0].length;
        }
        const rest = new state.Token("text", "", 0);
        rest.content = token.content.slice(last);
        children.push(rest);
      }
      block.children = children;
    });
  });

  // In the browser, "the console" (in prose: not headings, code or links) is the Agent UI tab:
  // named as the tab is, and a click away.
  md.core.ruler.push("agent_ui_links", (state) => {
    if (state.env.mode !== "browser") return;
    state.tokens.forEach((block, i) => {
      if (block.type !== "inline" || !block.children || state.tokens[i - 1]?.type === "heading_open") return;
      const children = [];
      let insideLink = 0;
      for (const token of block.children) {
        if (token.type === "link_open") insideLink++;
        if (token.type === "link_close") insideLink--;
        CONSOLE.lastIndex = 0;
        if (token.type !== "text" || insideLink || !CONSOLE.test(token.content)) {
          children.push(token);
          continue;
        }
        CONSOLE.lastIndex = 0;
        let last = 0;
        for (const match of token.content.matchAll(CONSOLE)) {
          const before = new state.Token("text", "", 0);
          before.content = token.content.slice(last, match.index);
          const link = new state.Token("html_inline", "", 0);
          link.content = `<a href="#" class="pane-ref" data-pane="console" title="Open the Agent UI beside the instructions">Agent UI</a>`;
          children.push(before, link);
          last = match.index + match[0].length;
        }
        const rest = new state.Token("text", "", 0);
        rest.content = token.content.slice(last);
        children.push(rest);
      }
      block.children = children;
    });
  });

  // In the browser, every "stop the worker", "restart the worker", "start the worker again"…
  // gets the worker toggle right after it, so the instructions always show the worker's state
  // where they ask you to change it. Not in headings.
  // In the browser, a block of just the plain worker command (`uv run hello-worker`) after a
  // sentence that starts the worker says nothing the sentence's toggle doesn't: it goes, and
  // the sentence's ":" pointing at it becomes ".". One with settings (FLAKY=1 …) stays: the
  // toggle can't start that.
  md.core.ruler.push("redundant_worker_blocks", (state) => {
    if (state.env.mode !== "browser") return;
    for (let i = state.tokens.length - 1; i >= 3; i--) {
      const fence = state.tokens[i];
      if (fence.type !== "fence" || !/^uv run (?:hello|travel)-worker$/.test(fence.content.trim())) continue;
      const [open, inline, close] = state.tokens.slice(i - 3, i);
      if (open.type !== "paragraph_open" || inline.type !== "inline" || close.type !== "paragraph_close") continue;
      // A copy without the g flag: test() on WORKER_PHRASE itself would move its lastIndex.
      if (!new RegExp(WORKER_PHRASE.source, "i").test(inline.content)) continue;
      state.tokens.splice(i, 1);
      const last = inline.children?.findLast((c) => c.type === "text");
      if (last) last.content = last.content.replace(/:\s*$/, ".");
    }
  });

  md.core.ruler.push("worker_toggles", (state) => {
    if (state.env.mode !== "browser") return;
    for (let i = 0; i < state.tokens.length; i++) {
      const block = state.tokens[i];
      if (block.type !== "inline" || state.tokens[i - 1]?.type === "heading_open") continue;
      const children = [];
      for (const token of block.children) {
        if (token.type !== "text" || !WORKER_PHRASE.test(token.content)) {
          children.push(token);
          continue;
        }
        WORKER_PHRASE.lastIndex = 0;
        let last = 0;
        for (const match of token.content.matchAll(WORKER_PHRASE)) {
          const end = match.index + match[0].length;
          const text = new state.Token("text", "", 0);
          text.content = token.content.slice(last, end);
          const toggle = new state.Token("html_inline", "", 0);
          // A restart, unless it's "with" something (FLAKY=1…): that's its ▶ command's job.
          const restart = /^restart/i.test(match[0]) && !/^\s+with\b/.test(token.content.slice(end));
          toggle.content = restart ? WORKER_RESTART : WORKER_TOGGLE;
          children.push(text, toggle);
          last = end;
        }
        const rest = new state.Token("text", "", 0);
        rest.content = token.content.slice(last);
        children.push(rest);
      }
      block.children = children;
    }
  });

  // In the browser, a quote is a message for the agent ("Send:", then `> I need a flight…`): a
  // button that sends it in the Agent UI's open session (ExerciseInstructions, through
  // SandboxPanes).
  md.core.ruler.push("agent_prompts", (state) => {
    if (state.env.mode !== "browser") return;
    for (let i = 0; i < state.tokens.length; i++) {
      if (state.tokens[i].type !== "blockquote_open" || state.tokens[i].level !== 0) continue;
      const close = state.tokens.findIndex((t, j) => j > i && t.type === "blockquote_close" && t.level === 0);
      const inlines = state.tokens.slice(i, close).filter((t) => t.type === "inline");
      const text = inlines.map((t) => t.content).join("\n").trim();
      const html = inlines.map((t) => state.md.renderer.renderInline(t.children, state.md.options, state.env)).join("<br>");
      const button = new state.Token("html_block", "", 0);
      button.content =
        `<button class="agent-prompt" type="button" data-send="${escapeAttr(text)}" title="Send this to the agent, in the Agent UI's open session">` +
        `<span class="ap-text">${html}</span><span class="ap-action">Send ▸</span></button>\n`;
      state.tokens.splice(i, close - i + 1, button);
    }
  });

  // `path/to/file.py` in prose opens the file.
  // `path/to/file.py` in prose opens the file; in the browser a command in prose
  // (`uv run hello-start SEA LHR`) gets a ▶ that types it into its terminal.
  md.renderer.rules.code_inline = (tokens, idx, _options, env) => {
    const content = tokens[idx].content;
    const file = content.replace(/:\d+$/, "");
    const attr = knownFiles.has(file) ? ` class="file-ref" data-file="${escapeAttr(file)}"` : "";
    const code = `<code${attr}>${md.utils.escapeHtml(content)}</code>`;
    if (env?.mode !== "browser" || !isInlineCommand(content)) return code;
    // The trip button says what it runs: the command beside it would only repeat it.
    if (HELLO_START.test(content)) return tripButton(content);
    const target = WORKER_COMMAND.test(content) ? "worker" : "commands";
    return (
      `<span class="cmd-ref">${code}<button class="cmd-run" type="button" data-run="${escapeAttr(JSON.stringify([content]))}" ` +
      `data-target="${target}" title="Run it in the ${target} terminal" aria-label="Run ${escapeAttr(content)} in the ${target} terminal">▶</button></span>`
    );
  };

  // Code blocks: highlighted, with Copy, and in the browser a ▶ that types shell commands
  // into the sandbox's terminal.
  md.renderer.rules.fence = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0] || "text";
    const code = token.content;
    const known = lang === "sh" ? "bash" : lang;
    const html = hljs.getLanguage(known)
      ? hljs.highlight(code, { language: known, ignoreIllegals: true }).value
      : md.utils.escapeHtml(code);
    let actions = `<button class="snippet-btn" type="button" data-copy>Copy</button>`;
    // A fence can name its file after the language (```python codemode/trip.py); otherwise the
    // snippet goes into the exercise's first editable file of its kind.
    const [declared, named] = token.info.trim().split(/\s+/);
    const target =
      env.mode === "browser" &&
      env.files?.find((f) => f.editable && (named ? f.path === named : SNIPPET_FILES[declared] && f.path.endsWith(SNIPPET_FILES[declared])));
    if (target) {
      const mode = insertMode(code, target.todo, target.path, target.starter);
      actions =
        `<button class="snippet-btn snippet-insert" type="button" data-insert="${escapeAttr(target.path)}" data-insert-mode="${mode}" ` +
        `title="${INSERT_TITLES[mode]} ${escapeAttr(target.path)}">← ${mode === "replace" ? "Replace in" : "Insert into"} ${escapeAttr(target.path.split("/").pop())}</button>` +
        actions;
    }
    if (env.mode === "browser" && known === "bash") {
      const commands = snippetCommands(code);
      // Starting a trip is the button, which says what it runs.
      if (commands.length === 1 && HELLO_START.test(commands[0])) return `<div class="trip-run">${tripButton(commands[0])}</div>\n`;
      if (commands.length) {
        const target = commands.every((c) => WORKER_COMMAND.test(c)) ? "worker" : "commands";
        actions =
          `<button class="snippet-btn snippet-run" type="button" data-run="${escapeAttr(JSON.stringify(commands))}" ` +
          // The worker's says so: it stops the worker that's running first.
          `data-target="${target}" title="Type this into the ${target} terminal">▶ ${target === "worker" ? "Run in worker" : "Run"}</button>` +
          actions;
      }
    }
    return (
      `<div class="snippet"><div class="snippet-actions">${actions}</div>` +
      `<pre class="hljs lang-${escapeAttr(lang)}"><code>${html}</code></pre></div>\n`
    );
  };

  return md;
}

// --- Snippets that go into the editor ------------------------------------------------------

const MARKER = /^\s*(?:#|\/\/) @@(solution ch(\d+)|starter|end)\s*$/;

// An exercise's TODO block in a master under authoring/: the lines learners start from, and
// the lines that solve it, exactly as they appear in the rendered files.
export function todoBlock(masterText, chapter) {
  const starter = [];
  const solution = [];
  let mode = null;
  let current = 0;
  for (const line of masterText.split("\n")) {
    const m = line.match(MARKER);
    if (m) {
      if (m[1].startsWith("solution")) {
        mode = "solution";
        current = Number(m[2]);
      } else mode = m[1] === "starter" ? "starter" : null;
      continue;
    }
    if (current !== chapter) continue;
    if (mode === "solution") solution.push(line);
    else if (mode === "starter") starter.push(line);
  }
  return starter.length ? { starter: `${starter.join("\n")}\n`, solution: `${solution.join("\n")}\n` } : null;
}

// Code compared without comments or whitespace, to tell a snippet that solves the TODO from
// one that adds something else.
export function codeShape(code) {
  return code
    .split("\n")
    .map((line) => line.replace(/\s+(#|\/\/)\s.*$/, ""))
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join("")
    .replace(/\s+/g, "");
}

const SNIPPET_FILES = { python: ".py", text: ".dw" };

// How a snippet goes into its file: "todo" replaces the TODO block (it's the solution);
// "replace" swaps a Dogwood rule the file already has (same @id) for the snippet; "append"
// adds a new rule at the end; "cursor" goes where the cursor is.
export function insertMode(code, todo, file, text = "") {
  if (todo && codeShape(todo.solution) === codeShape(code)) return "todo";
  if (!file.endsWith(".dw")) return "cursor";
  return ruleBlock(text, ruleId(code)) ? "replace" : "append";
}

const INSERT_TITLES = {
  todo: "Replace the TODO in",
  replace: "Replace the rule with this @id in",
  append: "Add it to the end of",
  cursor: "Insert it at the cursor in",
};

// --- The course --------------------------------------------------------------------------

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
}

function readIfExists(rel) {
  return fs.existsSync(path.join(repoRoot, rel)) ? read(rel) : null;
}

function renderPage(md, markdown, mode, sourceFile, files) {
  const { preamble, sections } = splitSections(applyMode(markdown, mode));
  const env = { mode, sourceFile, files };
  return {
    intro: md.render(preamble, env),
    sections: sections.map((section) => ({
      id: slugify(section.title),
      title: section.title,
      kind: sectionKind(section.title),
      html: md.render(section.lines.join("\n"), env),
    })),
  };
}

function buildExercise(md, dir) {
  const config = EXERCISES[dir];
  if (!config) throw new Error(`course/content/exercises.mjs has no entry for challenges/${dir}`);
  const source = `challenges/${dir}/assignment.md`;
  const { meta, body } = parseFrontmatter(read(source));
  const number = Number.parseInt(dir, 10);
  const chapter = `ch${String(number).padStart(2, "0")}`;
  const title = String(meta.title ?? dir).replace(/^\d+\s*·\s*/, "");
  const files = config.files.map((file) => {
    const master = readIfExists(`authoring/${file.path}`);
    return {
      path: file.path,
      editable: Boolean(file.editable),
      scratch: Boolean(file.scratch),
      starter: readIfExists(`starter/${file.path}`) ?? read(file.path),
      solution: readIfExists(`solutions/${chapter}/${file.path}`),
      todo: file.editable && master ? todoBlock(master, number) : null,
    };
  });
  const script = (name) => (fs.existsSync(path.join(repoRoot, "challenges", dir, name)) ? `./challenges/${dir}/${name}` : null);
  return {
    id: dir,
    number,
    slug: meta.slug ?? dir,
    title: title.replace(/\s*\(optional\)\s*$/i, ""),
    optional: /\(optional\)/i.test(title),
    teaser: meta.teaser ?? "",
    minutes: meta.timelimit ? Math.round(meta.timelimit / 60) : null,
    worker: config.worker,
    agentUi: config.agentUi !== false,
    questions: config.questions ?? [],
    tour: buildTour(md, dir, config.tour ?? [], files),
    scripts: { setup: script("setup.sh"), check: script("check.sh"), solve: script("solve.sh"), reset: script("reset.sh") },
    files,
    modes: Object.fromEntries(MODES.map((mode) => [mode, renderPage(md, body, mode, source, files)])),
  };
}

// The exercise's code tour, each stop checked against the file as learners start it, so a
// change to the code that moves an anchor fails the build rather than the tour.
function buildTour(md, dir, stops, files) {
  return stops.map((stop, i) => {
    const where = `course/content/exercises.mjs: ${dir}'s code tour, stop ${i + 1}`;
    const file = files.find((f) => f.path === stop.file);
    if (!file) throw new Error(`${where}: ${stop.file} isn't one of the exercise's files`);
    const range = tourRange(file.starter, stop, { strict: true });
    if (!range) throw new Error(`${where}: can't find ${JSON.stringify(stop.from)}${stop.to ? ` … ${JSON.stringify(stop.to)}` : ""} in ${stop.file}`);
    return { file: stop.file, from: stop.from, to: stop.to ?? null, title: stop.title, html: md.renderInline(stop.body) };
  });
}

function buildReadme(md) {
  const readme = read("README.md");
  const { preamble, sections } = splitSections(readme);
  const pick = (...titles) => sections.filter((s) => titles.includes(s.title)).map((s) => s.lines.join("\n")).join("\n\n");
  const env = { mode: "local", sourceFile: "README.md" };
  const title = readme.match(/^#\s+(.+)$/m)?.[1] ?? "Workshop";
  return {
    title,
    intro: md.render(preamble, env),
    architecture: md.render(pick("Architecture"), env),
    setup: md.render(pick("Set up", "Run it", "Repository map"), env),
  };
}

export function buildCourse() {
  knownFiles.clear();
  collectFiles();
  fs.rmSync(publicContent, { recursive: true, force: true });
  const md = createRenderer();
  const dirs = fs
    .readdirSync(path.join(repoRoot, "challenges"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const readme = buildReadme(md);
  return {
    title: readme.title,
    home: { intro: readme.intro, architecture: readme.architecture },
    setup: { html: readme.setup },
    exercises: dirs.map((dir) => buildExercise(md, dir)),
  };
}

// Writes the data only when it changed, so a watcher that rebuilds on writes can't loop.
export function writeCourse() {
  const course = buildCourse();
  const body = JSON.stringify(course);
  const version = crypto.createHash("sha256").update(body).digest("hex").slice(0, 12);
  const text = `${JSON.stringify({ version, ...course }, null, 1)}\n`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (!fs.existsSync(outFile) || fs.readFileSync(outFile, "utf8") !== text) fs.writeFileSync(outFile, text);
  return { file: outFile, version, exercises: course.exercises.length };
}

// The files whose edits should rebuild the content (for the dev server's watcher).
export function contentInputs() {
  const inputs = ["README.md", "course/content/exercises.mjs"];
  for (const dir of fs.readdirSync(path.join(repoRoot, "challenges"))) {
    if (fs.existsSync(path.join(repoRoot, "challenges", dir, "assignment.md"))) inputs.push(`challenges/${dir}/assignment.md`);
  }
  for (const stage of ["starter", "solutions"]) {
    const walk = (rel) => {
      for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else inputs.push(child);
      }
    };
    if (fs.existsSync(path.join(repoRoot, stage))) walk(stage);
  }
  for (const config of Object.values(EXERCISES)) for (const file of config.files) inputs.push(file.path);
  return [...new Set(inputs)].map((rel) => path.join(repoRoot, rel));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writeCourse();
  console.log(`Wrote ${path.relative(repoRoot, result.file)} (${result.exercises} exercises, version ${result.version})`);
}
