// The guide's messages arrive the way a model's reply does: typed out, with a caret. It works
// on the rendered message (any HTML): text is typed into its own nodes, and anything that
// isn't prose (a code block, a table, an image, a button) appears whole when the typing gets
// to it. An element shows only once something in it has, so nothing waits as an empty box.
// Long messages type faster, so none takes more than `maxMs`. It streams with reduced motion
// too, as a chat's reply does: it's text arriving, not movement (the caret just doesn't blink).

// Shown whole, never typed into.
const ATOMIC = "button, img, svg, pre, table, form, input, textarea, .snippet, .trip-run, .trip-toggle, .worker-toggle, .cmd-ref, .guide-passed";

export function streamIn(root, { charsPerSecond = 240, maxMs = 2500, onDone = () => {} } = {}) {
  if (!root) {
    onDone();
    return { finish() {} };
  }
  const units = [];
  const hidden = [];
  (function walk(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        units.push({ text: child, full: child.data, cost: child.data.trim() ? child.data.length : 0 });
        child.data = "";
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        child.classList.add("stream-hidden");
        hidden.push(child);
        if (child.matches(ATOMIC)) units.push({ el: child, cost: 24 });
        else walk(child);
      }
    }
  })(root);

  const total = units.reduce((sum, u) => sum + u.cost, 0);
  const speed = Math.max(charsPerSecond, (total * 1000) / maxMs);
  const caret = Object.assign(document.createElement("span"), { className: "stream-caret", ariaHidden: "true" });
  let index = 0;
  let typed = 0; // of the current unit
  let budget = 0;
  let last = performance.now();
  let frame = 0;
  let over = false;

  function show(unit) {
    for (let el = unit.el ?? unit.text.parentElement; el && el !== root; el = el.parentElement) el.classList.remove("stream-hidden");
  }

  function tick(now) {
    budget += ((now - last) / 1000) * speed;
    last = now;
    while (index < units.length && budget > 0) {
      const unit = units[index];
      show(unit);
      if (unit.el) {
        budget -= unit.cost;
        unit.el.after(caret);
        index++;
        continue;
      }
      const n = Math.min(unit.full.length, typed + Math.ceil(budget));
      budget -= n - typed;
      typed = n;
      unit.text.data = unit.full.slice(0, n);
      unit.text.after(caret);
      if (typed >= unit.full.length) {
        index++;
        typed = 0;
      }
    }
    if (index >= units.length) finish();
    else frame = requestAnimationFrame(tick);
  }

  // All of it, now: when it's done typing, when the learner clicks to skip, or when the
  // message is replaced.
  function finish() {
    if (over) return;
    over = true;
    cancelAnimationFrame(frame);
    for (const unit of units) if (unit.text) unit.text.data = unit.full;
    for (const el of hidden) el.classList.remove("stream-hidden");
    caret.remove();
    onDone();
  }

  frame = requestAnimationFrame(tick);
  return { finish };
}
