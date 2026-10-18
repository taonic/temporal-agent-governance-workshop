// Ask Temporal's answers, as HTML: Markdown with no raw HTML (the model's text is untrusted),
// code highlighted like the instructions' snippets, with Copy, links that open a new tab, and
// citations ([1], [2, 3]) turned into links to the sources they number.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt from "markdown-it";

for (const [name, lang] of Object.entries({ bash, go, java, json, python, typescript, yaml })) hljs.registerLanguage(name, lang);
const ALIASES = { sh: "bash", shell: "bash", console: "bash", zsh: "bash", py: "python", ts: "typescript", js: "typescript", javascript: "typescript", yml: "yaml", golang: "go" };

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
const escape = (value) => md.utils.escapeHtml(String(value ?? ""));

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const declared = token.info.trim().split(/\s+/)[0].toLowerCase();
  const lang = ALIASES[declared] ?? declared;
  const html = hljs.getLanguage(lang) ? hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value : escape(token.content);
  return (
    `<div class="snippet"><div class="snippet-actions">${declared ? `<span class="snippet-lang">${escape(declared)}</span>` : ""}` +
    `<button class="snippet-btn" type="button" data-copy>Copy</button></div>` +
    `<pre class="hljs"><code>${html}</code></pre></div>\n`
  );
};

const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, idx, options, env, self);
};

const CITATION = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g;

// Citations in text (not in code), as links to their sources.
md.core.ruler.push("citations", (state) => {
  const sources = state.env?.sources ?? [];
  if (!sources.length) return;
  const byNumber = new Map(sources.map((s) => [s.n, s]));
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const children = [];
    let insideLink = 0;
    for (const token of block.children) {
      if (token.type === "link_open") insideLink++;
      if (token.type === "link_close") insideLink--;
      if (token.type !== "text" || insideLink || !CITATION.test(token.content)) {
        children.push(token);
        continue;
      }
      CITATION.lastIndex = 0;
      let last = 0;
      for (const match of token.content.matchAll(CITATION)) {
        const numbers = match[1].split(",").map((n) => Number(n.trim()));
        if (!numbers.every((n) => byNumber.has(n))) continue;
        const before = new state.Token("text", "", 0);
        before.content = token.content.slice(last, match.index);
        const cite = new state.Token("html_inline", "", 0);
        cite.content = numbers
          .map((n) => {
            const source = byNumber.get(n);
            const label = `${source.title}${source.url ? ` · ${source.url.replace(/^https?:\/\//, "")}` : ""}`;
            return source.url
              ? `<a class="cite" href="${escape(source.url)}" target="_blank" rel="noopener noreferrer" title="${escape(label)}" data-n="${n}">${n}</a>`
              : `<span class="cite" title="${escape(label)}" data-n="${n}">${n}</span>`;
          })
          .join("");
        children.push(before, cite);
        last = match.index + match[0].length;
      }
      const rest = new state.Token("text", "", 0);
      rest.content = token.content.slice(last);
      children.push(rest);
    }
    block.children = children;
  }
});

export function renderAnswer(text, sources = []) {
  return md.render(String(text ?? ""), { sources });
}

// The source numbers an answer cites, in order of first use.
export function citedNumbers(text) {
  const seen = [];
  for (const match of String(text ?? "").matchAll(CITATION)) {
    for (const n of match[1].split(",").map((v) => Number(v.trim()))) if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}
