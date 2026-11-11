// Builds the course site's content from the workshop itself, so the site is never a second
// copy of it:
//
//   quests/<branch>/branch.md            the branches (quests/README.md has the format)
//   quests/<branch>/<NN-slug>/module.md  the modules: frontmatter, then the guide's text
//   quests/paths/*.yaml                  the paths, and the exercises the site shows them as
//   README.md                            the home page (its intro and architecture) and the setup page
//   starter/, authoring/                 the editor's starter, and its solution views
//
// Writes course/web/src/generated/course-data.json (and assignments.json, the exercises' text
// for Ask Temporal's prompt), and copies the files the content links to under docs/ into
// course/web/public/content/.
//
// Modules carry two kinds of mode block, so one file serves GitHub and both modes of the site:
//
//   <!-- browser
//   Only in the browser course. Inside a comment, so GitHub doesn't show it.
//   -->
//   <!-- local -->Only when running locally (and on GitHub).<!-- /local -->
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
import { ruleBlock, ruleId, todoFor } from "../web/src/snippets.js";
import { ICON_NAMES } from "../web/src/badgeArt.js";
import { SKILL_RULES } from "../web/src/badges.js";
import { BOARD_ACTIONS, WORLD_CHECKS } from "../web/src/board.js";

hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
// Dogwood (Cedar plus temporal conditions), colored as the editor colors a .dw file
// (CodeEditor.vue's StreamLanguage).
hljs.registerLanguage("dogwood", () => ({
  name: "Dogwood",
  keywords: {
    keyword: "permit forbid when unless temporal formerly within has like in is if then else principal action resource context",
    literal: "true false",
  },
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.QUOTE_STRING_MODE,
    { scope: "meta", match: /@\w+/ },
    { scope: "number", match: /\b\d+[dhms]?\b/ },
    { scope: "title", match: /\b[A-Z]\w*(?=::)/ },
  ],
}));

const courseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(courseDir, "..");
const outFile = path.join(courseDir, "web/src/generated/course-data.json");
const assignmentsFile = path.join(courseDir, "web/src/generated/assignments.json");
const publicContent = path.join(courseDir, "web/public/content");
// Where the build in progress writes it: a folder of its own, swapped in whole when the build is
// done (publishContent), so a build that fails, or runs at the same time as another (a test
// run's beside the dev server's), never leaves public/content half-written or gone.
let contentDir = publicContent;
let builds = 0;

// Where repo links point when they can't be shown on the site. Unset: they render as text.
const repoUrl = (process.env.COURSE_REPO_URL ?? "").replace(/\/$/, "");

const MODES = ["browser", "local"];

// A command typed into the worker terminal rather than the commands terminal when a ▶ is clicked.
export const WORKER_COMMAND = /^(?:\w+=\S+\s+)*uv run (?:hello|travel)-worker\b/;

// Inline code that's a command to run as it stands: no <placeholder> to fill in first.
export function isInlineCommand(text) {
  return /^(?:\w+=\S+\s+)*(?:uv run |temporal [a-z]|\.\/quest |cat )/.test(text) && !/[<>]/.test(text);
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
  if (/^challenge:/i.test(title)) return "challenge";
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
  [/^https?:\/\/localhost:8000\/briefing$/, "briefing"],
  [/^https?:\/\/localhost:8000(\/.*)?$/, "console"],
];

function copyToPublic(rel) {
  const src = path.join(repoRoot, rel);
  const dest = path.join(contentDir, rel.replace(/^docs\//, ""));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return `content/${rel.replace(/^docs\//, "")}`;
}

// Resolves a relative link in a markdown file to what the site should do with it.
function resolveRelative(href, sourceFile) {
  const [target, hash = ""] = href.split("#");
  const rel = path.normalize(path.join(path.dirname(sourceFile), target)).split(path.sep).join("/");
  const module = rel.match(/^quests\/[^/]+\/[^/]+\/module\.md$/) && moduleExercise.get(rel);
  if (module) return { href: `#/exercise/${module}` };
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
  // On the Trip board, #latest-trip opens its latest trip's workflow (#latest-trip/query: on a tab).
  // Locally, they're all just their words.
  md.core.ruler.push("action_links", (state) => {
    for (const block of state.tokens) {
      if (block.type !== "inline") continue;
      const children = [];
      for (let i = 0; i < block.children.length; i++) {
        const token = block.children[i];
        const href = token.type === "link_open" ? token.attrGet("href") ?? "" : "";
        const trip = href.match(/^#trip\/([A-Za-z]{3})-([A-Za-z]{3})(?:\/([a-z-]+))?$/);
        const flow = trip ? [null, `hello-${trip[1]}-${trip[2]}`.toLowerCase(), trip[3]] : href.match(/^#workflow\/([a-z0-9-]+)(?:\/([a-z-]+))?$/);
        const boardAction = href.match(/^#board\/([a-z-]+)$/)?.[1];
        const latest = href.match(/^#latest-trip(?:\/([a-z-]+))?$/);
        const persona = href.match(/^#persona\/([a-z-]+)$/)?.[1];
        if (persona && !loadPersonas().some((p) => p.id === persona)) throw new Error(`${state.env.sourceFile}: #persona/${persona} isn't a persona (quests/personas.yaml)`);
        const share = href === "#share";
        if (boardAction && !BOARD_ACTIONS.includes(boardAction)) {
          throw new Error(`${state.env.sourceFile}: #board/${boardAction} isn't one of the board's actions (${BOARD_ACTIONS.join(", ")})`);
        }
        if (href !== "#sandbox" && !flow && !boardAction && !latest && !persona && !share) {
          children.push(token);
          continue;
        }
        const close = block.children.findIndex((t, j) => j > i && t.type === "link_close");
        const label = block.children.slice(i + 1, close).map((t) => t.content).join("");
        const button = new state.Token("html_inline", "", 0);
        button.content =
          state.env.mode !== "browser"
            ? md.utils.escapeHtml(label)
            : boardAction
              ? `<button class="board-action" type="button" data-board-action="${boardAction}">${escapeAttr(label)}</button>`
              : persona
              ? `<button class="button" type="button" data-persona-switch="${persona}">${escapeAttr(label)}</button>`
              : share
              ? `<button class="button button-primary" type="button" data-share>${escapeAttr(label)}</button>`
              : latest
              ? `<button class="workflow-link" type="button" data-board-trip${latest[1] ? ` data-workflow-tab="${latest[1]}"` : ""} title="Open the latest trip in the Temporal UI">${escapeAttr(label)}</button>`
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

  // `path/to/file.py` in prose opens the file, and `TODO(ch02)` shows that TODO in it.
  // `path/to/file.py` in prose opens the file; in the browser a command in prose
  // (`uv run hello-start SEA LHR`) gets a ▶ that types it into its terminal.
  md.renderer.rules.code_inline = (tokens, idx, _options, env) => {
    const content = tokens[idx].content;
    const file = content.replace(/:\d+$/, "");
    const todo = /^TODO\(ch\d+\)$/.test(content);
    const attr = knownFiles.has(file)
      ? ` class="file-ref" data-file="${escapeAttr(file)}"`
      : todo
        ? ` class="todo-ref" data-todo="${escapeAttr(content)}" title="Show it in the code"`
        : "";
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
    // A fence can name its file after the language (```python hello/workflow.py); otherwise the
    // snippet goes into the exercise's first editable file of its kind.
    const [declared, named] = token.info.trim().split(/\s+/);
    const target =
      env.mode === "browser" &&
      env.files?.find((f) => f.editable && (named ? f.path === named : SNIPPET_FILES[declared] && f.path.endsWith(SNIPPET_FILES[declared])));
    if (target) {
      const mode = insertMode(code, target.todos, target.path, target.starter);
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

const MARKER = /^\s*(?:#|\/\/) @@(solution (\w+)|starter|end)\s*$/;

// The TODO blocks of some modules in a master under authoring/, in file order: for each, the
// lines learners start from (`starter`) and the lines that solve it (`solution`). A file can have
// several; each snippet replaces the one it solves.
export function todoBlocks(masterText, moduleIds) {
  const wanted = new Set(moduleIds);
  const blocks = [];
  let block = null;
  let mode = null;
  for (const line of masterText.split("\n")) {
    const m = line.match(MARKER);
    if (m) {
      if (m[1].startsWith("solution")) {
        mode = "solution";
        block = wanted.has(m[2]) ? { starter: [], solution: [] } : null;
        if (block) blocks.push(block);
      } else if (m[1] === "starter") mode = "starter";
      else block = mode = null;
      continue;
    }
    if (block && mode) block[mode].push(line);
  }
  return blocks
    .filter((b) => b.starter.length)
    .map((b) => ({ starter: `${b.starter.join("\n")}\n`, solution: `${b.solution.join("\n")}\n` }));
}

// A master as learners' code, with these modules' TODOs solved and every other one open
// (scripts/render.py, in JavaScript).
export function renderMaster(masterText, solvedIds) {
  const solved = new Set(solvedIds);
  const out = [];
  let mode = null;
  let module = null;
  const lines = masterText.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(MARKER);
    if (m) {
      if (m[1].startsWith("solution")) [mode, module] = ["solution", m[2]];
      else if (m[1] === "starter") mode = "starter";
      else mode = null;
      return;
    }
    if (mode === null || (mode === "solution") === solved.has(module)) out.push(i < lines.length - 1 ? `${line}\n` : line);
  });
  return out.join("");
}

const SNIPPET_FILES = { python: ".py", dogwood: ".dw" };

// How a snippet goes into its file: "todo" replaces the TODO block (it's the solution);
// "replace" swaps a Dogwood rule the file already has (same @id) for the snippet; "append"
// adds a new rule at the end; "cursor" goes where the cursor is.
export function insertMode(code, todos, file, text = "") {
  if (todoFor(todos, code)) return "todo";
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

// --- Quests: branches, modules and paths -----------------------------------------------------

// What an exercise's workspace is: the editor and terminals (code), or the Trip board (board).
export const LAYOUTS = ["code", "board"];

// Who the course is shown to (quests/personas.yaml): the first is the default.
export function loadPersonas() {
  const source = "quests/personas.yaml";
  const list = YAML.parse(read(source)) ?? [];
  if (!list.length) throw new Error(`${source}: no personas`);
  for (const p of list) for (const key of ["id", "label", "blurb", "icon"]) if (p[key] == null) throw new Error(`${source}: a persona has no ${key}`);
  if (new Set(list.map((p) => p.id)).size !== list.length) throw new Error(`${source}: two personas have one id`);
  return list;
}

const QUESTS = "quests";
// A module's file (quests/…/module.md) → the exercise the site shows it in: where links to it go.
const moduleExercise = new Map();

function subdirs(rel) {
  return fs
    .readdirSync(path.join(repoRoot, rel), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Every branch and module under quests/, and the paths through them, checked: ids unique, every
// module a module requires exists, and no module requires itself, however indirectly.
export function loadQuests() {
  const personas = loadPersonas();
  const branches = [];
  const modules = new Map();
  for (const dir of subdirs(QUESTS)) {
    const branchFile = `${QUESTS}/${dir}/branch.md`;
    if (!fs.existsSync(path.join(repoRoot, branchFile))) continue;
    const { meta, body } = parseFrontmatter(read(branchFile));
    if (meta.id !== dir) throw new Error(`${branchFile}: its id is ${meta.id}, but its folder is ${dir}`);
    const branch = { ...meta, personas: meta.personas ?? ["developer"], layout: meta.layout ?? "code", description: body.trim(), modules: [] };
    for (const id of branch.personas) {
      if (!personas.some((p) => p.id === id)) throw new Error(`${branchFile}: persona ${id} isn't one of ${personas.map((p) => p.id).join(", ")} (quests/personas.yaml)`);
    }
    if (!LAYOUTS.includes(branch.layout)) throw new Error(`${branchFile}: layout ${branch.layout} isn't one of ${LAYOUTS.join(", ")}`);
    for (const moduleDir of subdirs(`${QUESTS}/${dir}`)) {
      const challenge = loadChallenge(`${QUESTS}/${dir}/${moduleDir}`, dir);
      if (challenge) {
        if (modules.has(challenge.id)) throw new Error(`${challenge.source}: id ${challenge.id} is also ${modules.get(challenge.id).source}'s`);
        modules.set(challenge.id, challenge);
        branch.modules.push(challenge.id);
        continue;
      }
      const source = `${QUESTS}/${dir}/${moduleDir}/module.md`;
      if (!fs.existsSync(path.join(repoRoot, source))) continue;
      const { meta: m, body: text } = parseFrontmatter(read(source));
      for (const key of ["id", "title", "teaser", "learn", "minutes", "xp", "tier"]) {
        if (m[key] == null) throw new Error(`${source}: no ${key} in its frontmatter`);
      }
      if (modules.has(m.id)) throw new Error(`${source}: module id ${m.id} is also ${modules.get(m.id).source}'s`);
      checkModuleCheck(source, m.check, branch.layout);
      modules.set(m.id, {
        ...m,
        branch: dir,
        source,
        status: m.status ?? "ready",
        requires: m.requires ?? [],
        check: m.check ?? { kind: "pending" },
        worker: m.worker ?? meta.worker ?? null,
        agentUi: (m.agentUi ?? meta.agentUi) !== false,
        files: m.files ?? [],
        kind: "module",
        body: text,
      });
      branch.modules.push(m.id);
    }
    // Its boss: a quiz on the branch (issue 03), on the map from the start.
    const bossFile = `${QUESTS}/${dir}/boss/boss.md`;
    if (fs.existsSync(path.join(repoRoot, bossFile))) {
      const { meta: b } = parseFrontmatter(read(bossFile));
      for (const key of ["id", "title", "teaser", "learn"]) {
        if (b[key] == null) throw new Error(`${bossFile}: no ${key} in its frontmatter`);
      }
      if (modules.has(b.id)) throw new Error(`${bossFile}: id ${b.id} is also ${modules.get(b.id).source}'s`);
      modules.set(b.id, { ...b, kind: "boss", branch: dir, source: bossFile, status: b.status ?? "ready", requires: b.requires ?? [], check: { kind: "quiz" }, files: [], body: "" });
      branch.boss = b.id;
    }
    // A challenge sits after its module, takes its tier, and gates the next module.
    for (const id of branch.modules) {
      const ch = modules.get(id);
      if (ch.kind !== "challenge") continue;
      const after = modules.get(ch.after);
      if (!after || after.branch !== dir) throw new Error(`${ch.source}: after ${ch.after}, which isn't a module in ${dir}`);
      ch.tier = after.tier;
      const rest = branch.modules.slice(branch.modules.indexOf(id) + 1).map((m) => modules.get(m));
      ch.before = rest.find((m) => m.kind === "module")?.id ?? null;
    }
    branches.push(branch);
  }
  branches.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const branchOf = new Map(branches.map((b) => [b.id, b]));
  for (const module of modules.values()) {
    for (const req of module.requires) {
      if (!modules.has(req)) throw new Error(`${module.source}: requires ${req}, which isn't a module`);
      // A persona that sees the module has to see what it builds on.
      const missing = branchOf.get(module.branch).personas.filter((p) => !branchOf.get(modules.get(req).branch).personas.includes(p));
      if (missing.length) throw new Error(`${module.source}: requires ${req}, which the ${missing.join(", ")} persona doesn't see`);
    }
  }
  const done = new Set();
  const visit = (id, trail) => {
    if (done.has(id)) return;
    if (trail.includes(id)) throw new Error(`quests: modules require each other in a loop: ${[...trail, id].join(" → ")}`);
    for (const req of modules.get(id).requires) visit(req, [...trail, id]);
    done.add(id);
  };
  for (const id of modules.keys()) visit(id, []);
  const paths = [];
  for (const file of fs.readdirSync(path.join(repoRoot, QUESTS, "paths")).filter((f) => f.endsWith(".yaml")).sort()) {
    const source = `${QUESTS}/paths/${file}`;
    const p = YAML.parse(read(source));
    for (const ex of p.exercises ?? []) {
      for (const id of ex.modules) {
        if (!modules.has(id)) throw new Error(`${source}: exercise ${ex.id} names ${id}, which isn't a module`);
        if (modules.get(id).status !== "ready") throw new Error(`${source}: exercise ${ex.id} names ${id}, which is ${modules.get(id).status}`);
      }
    }
    const listed = p.modules ?? (p.exercises ?? []).flatMap((ex) => ex.modules);
    // Shown to the personas that see every one of its modules.
    const seen = personas.map((x) => x.id).filter((id) => listed.every((m) => branchOf.get(modules.get(m).branch).personas.includes(id)));
    if (!seen.length) throw new Error(`${source}: no persona sees all of its modules`);
    paths.push({ ...p, source, personas: seen, modules: withChallenges(listed, modules) });
  }
  return { branches, modules, paths, personas };
}

// --- Badges -----------------------------------------------------------------------------------

// A class title is its boss badge's ribbon: longer than this doesn't fit.
export const CLASS_TITLE_MAX = 20;
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

// Module ids as a criteria line reads them: runs of three or more as a range, the rest one by
// one, in order: ["F1", …, "F7", "FC1", "FC2"] → "F1–F7, FC1 and FC2".
export function idList(ids) {
  const parse = (id) => {
    const m = /^(.*?)(\d+)$/.exec(id);
    return m ? { prefix: m[1], n: Number(m[2]) } : { prefix: id, n: null };
  };
  const sorted = [...ids].sort((a, b) => {
    const [x, y] = [parse(a), parse(b)];
    return x.prefix === y.prefix ? (x.n ?? 0) - (y.n ?? 0) : x.prefix.length - y.prefix.length || x.prefix.localeCompare(y.prefix);
  });
  const runs = [];
  for (const id of sorted) {
    const { prefix, n } = parse(id);
    const last = runs.at(-1);
    if (last && n !== null && last.prefix === prefix && last.to + 1 === n) {
      last.to = n;
      last.ids.push(id);
    } else runs.push({ prefix, from: n, to: n, ids: [id] });
  }
  const items = runs.flatMap((r) => (r.ids.length >= 3 ? [`${r.prefix}${r.from}–${r.prefix}${r.to}`] : r.ids));
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// Every badge, checked: a tier badge per tier that names one (branch.md), a boss badge per boss
// (its class title), and the skill badges (quests/badges.yaml).
export function loadBadges(quests) {
  const badges = [];
  const ids = new Set();
  const add = (badge, source) => {
    if (ids.has(badge.id)) throw new Error(`${source}: badge id ${badge.id} is taken`);
    if (!ICON_NAMES.includes(badge.icon)) throw new Error(`${source}: badge icon ${badge.icon} isn't one of ${ICON_NAMES.join(", ")}`);
    ids.add(badge.id);
    badges.push(badge);
  };
  for (const branch of quests.branches) {
    const source = `${QUESTS}/${branch.id}/branch.md`;
    if (branch.classTitle && branch.classTitle.length > CLASS_TITLE_MAX) {
      throw new Error(`${source}: classTitle "${branch.classTitle}" is over ${CLASS_TITLE_MAX} characters, too long for its badge`);
    }
    (branch.tiers ?? []).forEach((tier, i) => {
      if (tier.badge === false) return;
      if (!tier.badge?.name) throw new Error(`${source}: tier ${tier.name} has no badge name (badge: { name }, or badge: false for none)`);
      const modules = branch.modules.filter((id) => quests.modules.get(id).tier === i + 1);
      if (!modules.length) throw new Error(`${source}: tier ${tier.name}'s badge has no modules`);
      add({
        id: `${branch.id}-${i + 1}`,
        personas: branch.personas,
        kind: "tier",
        name: tier.badge.name,
        branch: branch.id,
        color: branch.color,
        icon: branch.badgeIcon,
        tier: i + 1,
        tierName: tier.name,
        numeral: ROMAN[i + 1] ?? String(i + 1),
        modules,
        criteria: `Pass ${idList(modules)}`,
      }, source);
    });
    if (branch.boss) {
      if (!branch.classTitle) throw new Error(`${source}: a branch with a boss needs a classTitle, its boss badge`);
      const boss = quests.modules.get(branch.boss);
      add({ id: `${branch.id}-boss`, personas: branch.personas, kind: "boss", name: branch.classTitle, branch: branch.id, color: branch.color, icon: branch.badgeIcon, module: boss.id, criteria: `Beat ${boss.title}` }, source);
    }
  }
  const source = `${QUESTS}/badges.yaml`;
  const skills = fs.existsSync(path.join(repoRoot, source)) ? (YAML.parse(read(source)) ?? []) : [];
  for (const b of skills) {
    for (const key of ["id", "name", "icon", "rule", "criteria"]) if (b[key] == null) throw new Error(`${source}: a badge has no ${key}`);
    if (!SKILL_RULES.includes(b.rule)) throw new Error(`${source}: ${b.id}'s rule ${b.rule} isn't one of ${SKILL_RULES.join(", ")}`);
    if (b.rule === "pass" && !quests.modules.has(b.module)) throw new Error(`${source}: ${b.id} passes ${b.module}, which isn't a module`);
    const everyone = quests.personas.map((p) => p.id);
    for (const id of b.personas ?? []) if (!everyone.includes(id)) throw new Error(`${source}: ${b.id}'s persona ${id} isn't one of ${everyone.join(", ")}`);
    add({ id: b.id, personas: b.personas ?? everyone, kind: "skill", name: b.name, icon: b.icon, rule: b.rule, ...(b.module ? { module: b.module } : {}), criteria: b.criteria }, source);
  }
  return badges;
}

// A challenge folder (challenge.md, scenario.py, recordings/): the question, its choices, and
// each choice's recorded run. null for a module's folder.
//
// A question challenge (Essentials') has no file, no block it replaces and no code in its
// choices: nothing runs, so it has no scenario and no recordings. Its choices are plain answers.
function loadChallenge(dir, branch) {
  const source = `${dir}/challenge.md`;
  if (!fs.existsSync(path.join(repoRoot, source))) return null;
  const { meta, body } = parseFrontmatter(read(source));
  const question = meta.file == null && meta.replace == null;
  for (const key of ["id", "title", "teaser", "learn", "after", "hint", "choices", ...(question ? [] : ["file", "replace"])]) {
    if (meta[key] == null) throw new Error(`${source}: no ${key} in its frontmatter`);
  }
  checkChoices(source, meta.choices);
  const choices = meta.choices.map((c, i) => {
    const id = "ABCD"[i];
    if (question) {
      if (c.code != null) throw new Error(`${source}: choice ${id} has code, but the challenge has no file (a question challenge's choices are plain answers)`);
      return { id, label: c.label, code: "", explanation: c.explanation, right: Boolean(c.right), recording: null };
    }
    const recording = readIfExists(`${dir}/recordings/${id}.json`);
    if (!recording) throw new Error(`${source}: choice ${id} has no recording (uv run python scripts/record_challenges.py ${meta.id})`);
    const { lines, done } = JSON.parse(recording);
    return { id, label: c.label, code: c.code ?? "", explanation: c.explanation, right: Boolean(c.right), recording: { lines, done } };
  });
  return {
    id: meta.id,
    kind: "challenge",
    branch,
    source,
    title: meta.title,
    teaser: meta.teaser,
    learn: meta.learn,
    minutes: meta.minutes ?? 3,
    xp: CHALLENGE_XP[0],
    after: meta.after,
    requires: meta.requires ?? [meta.after],
    status: "ready",
    check: { kind: "challenge" },
    files: [],
    body,
    question,
    file: meta.file ?? null,
    replace: meta.replace ?? null,
    hint: meta.hint,
    choices,
  };
}

// How a module passes. code: its pytest checks; pending: by moving on from it; world (a Trip
// board module's): when the board has seen what it names happen, and its one question is answered.
export const CHECK_KINDS = ["code", "pending", "world"];

function checkModuleCheck(source, check, layout) {
  if (!check) return;
  if (!CHECK_KINDS.includes(check.kind)) throw new Error(`${source}: check kind ${check.kind} isn't one of ${CHECK_KINDS.join(", ")}`);
  if (check.kind !== "world") return;
  if (layout !== "board") throw new Error(`${source}: a world check needs the Trip board (its branch's layout is ${layout})`);
  if (!WORLD_CHECKS.includes(check.world)) throw new Error(`${source}: world check ${check.world} isn't one of ${WORLD_CHECKS.join(", ")} (essentials/checks.py)`);
  for (const key of ["waiting", "seen", "quiz"]) if (check[key] == null) throw new Error(`${source}: its world check has no ${key}`);
  if (!check.quiz.question) throw new Error(`${source}: its quiz has no question`);
  checkChoices(`${source} (its quiz)`, check.quiz.choices);
}

// A question's choices (a challenge's, or a module's quiz): two to four, each with a label and an
// explanation, exactly one of them right.
function checkChoices(source, choices) {
  if (!Array.isArray(choices) || choices.length < 2 || choices.length > 4) throw new Error(`${source}: a question has 2 to 4 choices`);
  if (choices.filter((c) => c.right).length !== 1) throw new Error(`${source}: exactly one choice is right`);
  for (const [i, c] of choices.entries()) {
    if (!c.label || !c.explanation) throw new Error(`${source}: choice ${"ABCD"[i]} needs a label and an explanation`);
  }
}

// A challenge's XP: right first time, second time, any time after.
export const CHALLENGE_XP = [20, 10, 2];

// A list of modules, with each challenge after the module it follows.
function withChallenges(ids, modules) {
  const out = [];
  for (const id of ids) {
    out.push(id);
    for (const m of modules.values()) if (m.kind === "challenge" && m.after === id && !ids.includes(m.id)) out.push(m.id);
  }
  return out;
}

// Every module the given ones build on, directly or not: not the given ones themselves, unless
// one builds on another.
export function closure(modules, ids) {
  const seen = new Set();
  const stack = ids.flatMap((id) => modules.get(id).requires);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...modules.get(id).requires);
  }
  return [...modules.keys()].filter((id) => seen.has(id));
}

// The beats a module's text makes in the guide: its sections' ids ("intro" first, for the
// module that opens an exercise).
function moduleBeats(module, first) {
  const { preamble, sections } = splitSections(module.body);
  if (!first && preamble) {
    throw new Error(`${module.source}: has text before its first ## heading, but doesn't open its exercise (only the first module of an exercise can, until the site shows modules on their own)`);
  }
  return [...(first ? ["intro"] : []), ...sections.map((s) => slugify(s.title))];
}

// A path's exercise, as the site shows it until it shows the map: its modules' text, one after
// the other, and their files, tour and questions together.
function buildExercise(md, quests, ex, number) {
  const mods = ex.modules.map((id) => quests.modules.get(id));
  const where = `${quests.paths.find((p) => p.exercises?.includes(ex)).source}: exercise ${ex.id}`;
  const beats = new Map(mods.map((m, i) => [m.id, moduleBeats(m, i === 0)]));
  // A challenge is a beat of its own, after the module it follows (before that module's check).
  const challenges = [...quests.modules.values()].filter((c) => c.kind === "challenge" && ex.modules.includes(c.after));
  const texts = mods.map((m) => {
    const challenge = challenges.find((c) => c.after === m.id);
    if (!challenge) return m.body.trim();
    const section = `## Challenge: ${challenge.title}\n\n${challenge.body.trim()}`;
    beats.set(challenge.id, [slugify(`Challenge: ${challenge.title}`)]);
    // Before the module's check, or (a world check on a beat of its own: E8's, before the
    // course's closing beat) right after that beat.
    let at = m.body.search(/^## Check\s*$/m);
    if (m.check?.beat) {
      const heading = m.body.search(new RegExp(`^## ${m.check.beat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"));
      const next = heading < 0 ? -1 : m.body.slice(heading + 3).search(/^## /m);
      at = next < 0 ? -1 : heading + 3 + next;
    }
    return at < 0 ? `${m.body.trim()}\n\n${section}` : `${m.body.slice(0, at).trim()}\n\n${section}\n\n${m.body.slice(at).trim()}`;
  });
  const body = `${texts.join("\n\n")}\n`;
  // The guide finds a beat's module, and where the learner was, by its id: no two the same.
  const ids = [...beats.values()].flat();
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw new Error(`${where}: two sections are both "${twice}" (give one of them another heading)`);
  const workers = new Set(mods.map((m) => m.worker));
  if (workers.size > 1) throw new Error(`${where}: its modules have different workers (${[...workers].join(", ")})`);
  const layouts = new Set(mods.map((m) => quests.branches.find((b) => b.id === m.branch).layout));
  if (layouts.size > 1) throw new Error(`${where}: its modules have different layouts (${[...layouts].join(", ")})`);
  const [layout] = layouts;

  const solved = [...closure(quests.modules, ex.modules), ...ex.modules];
  const byPath = new Map();
  for (const m of mods) {
    for (const f of m.files) {
      const file = byPath.get(f.path) ?? { path: f.path, editable: false, scratch: false, modules: [] };
      file.editable ||= Boolean(f.editable);
      file.scratch ||= Boolean(f.scratch);
      file.modules.push(m.id);
      byPath.set(f.path, file);
    }
  }
  const files = [...byPath.values()].map((file) => {
    const master = readIfExists(`authoring/${file.path}`);
    return {
      path: file.path,
      // The beats its tab shows on: those of the modules that list it (null: every beat).
      beats: file.modules.length === mods.length ? null : mods.filter((m) => file.modules.includes(m.id)).flatMap((m) => beats.get(m.id)),
      editable: file.editable,
      scratch: file.scratch,
      starter: readIfExists(`starter/${file.path}`) ?? read(file.path),
      solution: master ? renderMaster(master, solved) : null,
      todos: file.editable && master ? todoBlocks(master, ex.modules) : [],
    };
  });

  // The code tour: one module's. It's offered at that module's start (the end of the briefing,
  // for the first), or on leaving its `tourAfter` beat.
  const touring = mods.filter((m) => m.tour?.length);
  if (touring.length > 1) throw new Error(`${where}: more than one of its modules has a code tour (${touring.map((m) => m.id).join(", ")})`);
  const tm = touring[0];
  let tourAfter = null;
  if (tm?.tourAfter) tourAfter = tourBeat(tm, tm.tourAfter);
  else if (tm && tm !== mods[0]) tourAfter = beats.get(mods[mods.indexOf(tm) - 1].id).at(-1);

  return {
    id: ex.id,
    number,
    slug: ex.id.replace(/^\d+-/, ""),
    title: ex.title,
    bonus: Boolean(ex.bonus),
    teaser: ex.teaser ?? "",
    minutes: [...mods, ...challenges].reduce((sum, m) => sum + (m.minutes ?? 0), 0),
    modules: withChallenges(ex.modules, quests.modules),
    // Each module's beats in the guide, so a link to a module opens the guide at it.
    moduleBeats: Object.fromEntries(beats),
    worker: mods[0].worker,
    agentUi: mods[0].agentUi,
    layout,
    personas: quests.paths.find((p) => p.exercises?.includes(ex)).personas,
    // A board exercise's modules: how each one's board starts (essentials/board.py reads the same).
    ...(layout === "board"
      ? {
          boards: Object.fromEntries(mods.map((m) => [m.id, boardOf(m)])),
          // Each module's world check and its question, on the beat it shows on.
          checks: Object.fromEntries(mods.filter((m) => m.check.kind === "world").map((m) => [m.id, worldCheckData(md, m, beats.get(m.id))])),
          // Each module's recorded walkthrough (scripts/record_walkthroughs.py), for a visitor
          // without a sandbox to watch: served beside the site, fetched when it's wanted.
          walkthroughs: Object.fromEntries(
            mods.flatMap((m) => {
              const rel = `${path.dirname(m.source)}/walkthrough.json`;
              if (!fs.existsSync(path.join(repoRoot, rel))) return [];
              const dest = path.join(contentDir, "walkthroughs", `${m.id}.json`);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.copyFileSync(path.join(repoRoot, rel), dest);
              return [[m.id, `content/walkthroughs/${m.id}.json`]];
            }),
          ),
        }
      : {}),
    questions: [...new Set(mods.flatMap((m) => m.questions ?? []))],
    tour: tm ? buildTour(md, tm, files) : [],
    tourAfter,
    scripts:
      layout === "board"
        ? {}
        : {
            setup: `./quest enter ${ex.id}`,
            check: `./quest check ${ex.id}`,
            solve: `./quest solve ${ex.id}`,
            reset: `./quest reset ${ex.id}`,
          },
    files,
    // Its challenges, by id: the question's choices, each with its recorded run.
    challenges: Object.fromEntries(challenges.map((c) => [c.id, challengeData(md, c)])),
    modes: Object.fromEntries(
      MODES.map((mode) => {
        const page = renderPage(md, body, mode, mods[0].source, files);
        for (const section of page.sections) {
          if (section.kind === "challenge") section.challenge = challenges.find((c) => beats.get(c.id)[0] === section.id).id;
        }
        return [mode, page];
      }),
    ),
  };
}

// How a module's Trip board starts (essentials/board.py BOARD_DEFAULTS reads the same keys).
const BOARD_KEYS = { twin: false, mistake: false, onShift: true, hold: false, approval: false, declined: false };
function boardOf(m) {
  for (const key of Object.keys(m.board ?? {})) {
    if (!(key in BOARD_KEYS)) throw new Error(`${m.source}: board.${key} isn't one of ${Object.keys(BOARD_KEYS).join(", ")}`);
  }
  return Object.fromEntries(Object.entries(BOARD_KEYS).map(([key, otherwise]) => [key, Boolean(m.board?.[key] ?? otherwise)]));
}

// What the guide shows for a module's world check: what it waits for, what it saw, and the
// question, on the module's last beat (or check.beat's).
function worldCheckData(md, m, beats) {
  const beat = m.check.beat ? slugify(m.check.beat) : beats.at(-1);
  if (!beats.includes(beat)) throw new Error(`${m.source}: check.beat ${m.check.beat} isn't one of its sections`);
  return {
    world: m.check.world,
    beat,
    waiting: m.check.waiting,
    seen: m.check.seen,
    quiz: {
      question: md.renderInline(m.check.quiz.question),
      choices: m.check.quiz.choices.map((c, i) => ({ id: "ABCD"[i], label: md.renderInline(c.label), explanation: md.renderInline(c.explanation), right: Boolean(c.right) })),
    },
  };
}

// What the guide needs to run a challenge: its choices (the code, highlighted, and the block it
// replaces, for the diff), the hint, and each choice's recording.
function challengeData(md, c) {
  return {
    id: c.id,
    title: c.title,
    question: c.question,
    file: c.file,
    replace: c.replace,
    hint: md.renderInline(c.hint),
    xp: CHALLENGE_XP,
    choices: c.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      code: choice.code,
      explanation: md.renderInline(choice.explanation),
      right: choice.right,
      recording: choice.recording,
    })),
  };
}

// The beat that offers the code tour, when it isn't the module's start: its section's id.
function tourBeat(module, heading) {
  const section = splitSections(module.body).sections.find((s) => s.title === heading);
  if (!section) throw new Error(`${module.source}: its tourAfter names "${heading}", which isn't one of its headings`);
  return slugify(section.title);
}

// A module's code tour, each stop checked against the file as learners start it, so a change to
// the code that moves an anchor fails the build rather than the tour.
function buildTour(md, module, files) {
  return module.tour.map((stop, i) => {
    const where = `${module.source}: code tour, stop ${i + 1}`;
    const file = files.find((f) => f.path === stop.file);
    if (!file || !module.files.some((f) => f.path === stop.file)) throw new Error(`${where}: ${stop.file} isn't one of the module's files`);
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
  const staging = `${publicContent}.building-${process.pid}-${++builds}`;
  contentDir = staging;
  try {
    const course = assembleCourse();
    publishContent(staging);
    return course;
  } finally {
    contentDir = publicContent;
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// A finished build's files in place of the last one's: two renames, retried if another build
// swaps its own in at the same moment.
function publishContent(staging) {
  fs.mkdirSync(staging, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    const old = `${publicContent}.old-${process.pid}-${builds}-${attempt}`;
    try {
      if (fs.existsSync(publicContent)) fs.renameSync(publicContent, old);
      fs.renameSync(staging, publicContent);
      fs.rmSync(old, { recursive: true, force: true });
      return;
    } catch (err) {
      // The last build's files back, if they were moved aside and nothing took their place.
      try {
        if (fs.existsSync(old) && !fs.existsSync(publicContent)) fs.renameSync(old, publicContent);
      } catch {
        /* another build's files went in first */
      }
      fs.rmSync(old, { recursive: true, force: true });
      if (attempt >= 5 || !["ENOTEMPTY", "EEXIST", "ENOENT", "EPERM"].includes(err.code)) throw err;
    }
  }
}

function assembleCourse() {
  knownFiles.clear();
  collectFiles();
  const quests = loadQuests();
  const exercises = quests.paths.flatMap((p) => p.exercises ?? []);
  moduleExercise.clear();
  for (const ex of exercises) for (const id of withChallenges(ex.modules, quests.modules)) moduleExercise.set(quests.modules.get(id).source, ex.id);
  const md = createRenderer();
  const readme = buildReadme(md);
  return {
    title: readme.title,
    home: { intro: readme.intro, architecture: readme.architecture },
    setup: { html: readme.setup },
    exercises: exercises.map((ex, i) => buildExercise(md, quests, ex, i + 1)),
    branches: quests.branches.map(({ modules, ...branch }) => ({ ...branch, modules })),
    modules: [...quests.modules.values()].map((m) => ({
      id: m.id,
      kind: m.kind,
      branch: m.branch,
      title: m.title,
      teaser: m.teaser,
      learn: m.learn,
      minutes: m.minutes,
      xp: m.xp,
      tier: m.tier,
      requires: m.requires,
      status: m.status,
      check: m.check.kind,
      exercise: moduleExercise.get(m.source) ?? null,
      // A challenge: the module it follows, and the one it gates.
      ...(m.kind === "challenge" ? { after: m.after, before: m.before, choices: m.choices.length } : {}),
    })),
    paths: quests.paths.map((p) => ({ id: p.id, title: p.title, modules: p.modules, personas: p.personas })),
    personas: quests.personas,
    badges: loadBadges(quests),
  };
}

// The exercises' text, as written (mode blocks and all), for Ask Temporal's prompt: the runner
// reads it (runner/helper.mjs), and has no Markdown or YAML of its own.
export function buildAssignments() {
  const quests = loadQuests();
  const out = {};
  for (const ex of quests.paths.flatMap((p) => p.exercises ?? [])) {
    out[ex.id] = { title: ex.title, text: ex.modules.map((id) => quests.modules.get(id).body.trim()).join("\n\n") };
  }
  return out;
}

function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
}

// Writes the data only when it changed, so a watcher that rebuilds on writes can't loop.
export function writeCourse() {
  const course = buildCourse();
  const body = JSON.stringify(course);
  const version = crypto.createHash("sha256").update(body).digest("hex").slice(0, 12);
  writeIfChanged(outFile, `${JSON.stringify({ version, ...course }, null, 1)}\n`);
  writeIfChanged(assignmentsFile, `${JSON.stringify(buildAssignments(), null, 1)}\n`);
  return { file: outFile, version, exercises: course.exercises.length, modules: course.modules.length };
}

// The files whose edits should rebuild the content (for the dev server's watcher).
export function contentInputs() {
  const inputs = ["README.md"];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (!entry.name.startsWith(".")) inputs.push(child);
    }
  };
  for (const dir of [QUESTS, "starter", "authoring"]) if (fs.existsSync(path.join(repoRoot, dir))) walk(dir);
  for (const module of loadQuests().modules.values()) for (const file of module.files) inputs.push(file.path);
  return [...new Set(inputs)].map((rel) => path.join(repoRoot, rel));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writeCourse();
  console.log(`Wrote ${path.relative(repoRoot, result.file)} (${result.exercises} exercises, ${result.modules} modules, version ${result.version})`);
}
