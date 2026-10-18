// Where a code tour stop is in a file: its first and last line (1-based), found by text so it
// survives edits. `from` is a piece of the first line; `to`, a piece of the last (the first
// line after `from` that has it). Without `to` (or when a learner's edits removed it), a first
// line that opens a block (`def …:`, `with …:`, decorators included) takes the block, and
// anything else runs to the next blank line. The build checks the anchors against the starter
// (strict: `to` must be there); the page finds them in whatever the file says now.
export function tourRange(text, { from, to }, { strict = false } = {}) {
  const lines = String(text ?? "").split("\n");
  const start = lines.findIndex((line) => line.includes(from));
  if (start < 0) return null;
  if (to) {
    const end = lines.findIndex((line, n) => n > start && line.includes(to));
    if (end >= 0) return { start: start + 1, end: end + 1 };
    if (strict) return null;
  }
  return { start: start + 1, end: blockEnd(lines, start) + 1 };
}

const indent = (line) => line.match(/^\s*/)[0].length;
const blank = (line) => !line.trim();

function blockEnd(lines, start) {
  // Decorators belong to what they decorate.
  let head = start;
  while (/^\s*@/.test(lines[head]) && /^\s*(?:@|def |async def |class )/.test(lines[head + 1] ?? "")) head++;
  let end = head;
  if (/:\s*$/.test(lines[head])) {
    for (let n = head + 1; n < lines.length; n++) {
      if (blank(lines[n])) continue;
      if (indent(lines[n]) <= indent(lines[head])) break;
      end = n;
    }
    return end;
  }
  while (end + 1 < lines.length && !blank(lines[end + 1])) end++;
  return end;
}
