// Snippets from the instructions, in the editor: how they're laid out when inserted, and how
// to find one in a file again (to show its Insert button as Revert, and to take it back out).

export function dedent(code) {
  const lines = code.replace(/\s+$/, "").split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut));
}

export function indentLines(lines, indent) {
  return lines.map((l) => (l.trim() ? indent + l : "")).join("\n");
}

// Code without comments or whitespace: the same code, however it's commented or laid out.
export function shape(code) {
  return code
    .split("\n")
    .map((l) => l.replace(/\s+(#|\/\/)\s.*$/, ""))
    .filter((l) => !/^\s*(#|\/\/)/.test(l))
    .join("")
    .replace(/\s+/g, "");
}

// Where a snippet sits in a file, line for line (indentation aside), as it was inserted:
// { start, end } offsets from the start of its first line to the end of its last, or null if
// it isn't there as written.
export function findSnippet(text, code) {
  if (!text || !code) return null;
  const want = dedent(code).map((l) => l.trim());
  while (want.length && !want[0]) want.shift();
  while (want.length && !want[want.length - 1]) want.pop();
  if (!want.length) return null;
  const lines = text.split("\n");
  const offsets = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  for (let i = 0; i + want.length <= lines.length; i++) {
    if (lines[i].trim() !== want[0]) continue;
    let k = 1;
    while (k < want.length && lines[i + k].trim() === want[k]) k++;
    if (k === want.length) {
      const last = i + want.length - 1;
      return { start: offsets[i], end: offsets[last] + lines[last].length };
    }
  }
  return null;
}

// A Dogwood rule's id: what `@id("…")` names, or null.
export function ruleId(code) {
  return code.match(/@id\("([^"]+)"\)/)?.[1] ?? null;
}

// Where the rule with this id sits in a policy: { start, end } offsets from its first line (the
// comment lines right above it count) to the end of its closing `};` line, or null.
export function ruleBlock(text, id) {
  if (!text || !id) return null;
  const lines = text.split("\n");
  const offsets = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  let first = lines.findIndex((l) => l.trim() === `@id("${id}")`);
  if (first < 0) return null;
  let last = first;
  while (last < lines.length && lines[last].trim() !== "};") last++;
  if (last === lines.length) return null;
  while (first > 0 && lines[first - 1].trim().startsWith("//")) first--;
  return { start: offsets[first], end: offsets[last] + lines[last].length };
}
