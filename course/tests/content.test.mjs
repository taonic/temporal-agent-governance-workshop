import assert from "node:assert/strict";
import { test } from "node:test";

import { applyMode, buildCourse, parseFrontmatter, sectionKind, snippetCommands, splitSections } from "../content/build.mjs";

test("a browser block shows only in the browser, a local block only locally", () => {
  const md = "Before.\n<!-- browser\nIn the browser.\n-->\n<!-- local -->\nOn your machine.\n<!-- /local -->\nAfter.\n";
  assert.equal(applyMode(md, "browser"), "Before.\nIn the browser.\nAfter.\n");
  assert.equal(applyMode(md, "local"), "Before.\nOn your machine.\nAfter.\n");
});

test("an inline browser block joins its line", () => {
  const md = "Stop it and start it again<!-- browser\n (or click Restart)\n-->. Then wait.\n";
  assert.equal(applyMode(md, "browser"), "Stop it and start it again (or click Restart). Then wait.\n");
  assert.equal(applyMode(md, "local"), "Stop it and start it again. Then wait.\n");
});

test("frontmatter is parsed and removed", () => {
  const { meta, body } = parseFrontmatter('---\ntitle: "1 · Hello"\ntimelimit: 2100\n---\n\n# Hello\n');
  assert.deepEqual(meta, { title: "1 · Hello", timelimit: 2100 });
  assert.equal(body, "\n# Hello\n");
});

test("sections split at level-2 headings, not inside code fences", () => {
  const { preamble, sections } = splitSections("# Title\nIntro.\n## 1. One\n```\n## not a heading\n```\n## Check\nRun it.");
  assert.equal(preamble, "Intro.");
  assert.deepEqual(sections.map((s) => s.title), ["1. One", "Check"]);
  assert.deepEqual(["1. One", "Check", "Stretch (not graded)", "The pieces"].map(sectionKind), ["step", "check", "stretch", "plain"]);
});

test("snippet commands drop comments and join continuations", () => {
  const code = "# a comment\nuv run travel-stack up   # start it\n\ntemporal workflow update execute --workflow-id x \\\n  --input '{}'\n";
  assert.deepEqual(snippetCommands(code), ["uv run travel-stack up", "temporal workflow update execute --workflow-id x --input '{}'"]);
});

test("the built course covers every exercise in both modes", () => {
  const course = buildCourse();
  assert.equal(course.exercises.length, 5);
  for (const exercise of course.exercises) {
    for (const mode of ["browser", "local"]) {
      const html = [exercise.modes[mode].intro, ...exercise.modes[mode].sections.map((s) => s.html)].join("\n");
      assert.ok(!/<!--\s*(browser|local|\/local)/.test(html), `${exercise.id} ${mode} still has a mode marker`);
      if (mode === "local") assert.ok(!html.includes("data-pane"), `${exercise.id}: local links must stay links`);
    }
    assert.ok(exercise.files.some((f) => f.editable) || exercise.optional, `${exercise.id} has no editable file`);
    for (const file of exercise.files.filter((f) => f.editable && !f.scratch)) {
      assert.ok(file.solution, `${exercise.id}: ${file.path} has no solution`);
      assert.notEqual(file.starter, file.solution, `${exercise.id}: ${file.path} starter equals its solution`);
    }
  }
});

test("in the browser, localhost links open panes and command snippets get a run button", () => {
  const hello = buildCourse().exercises[0];
  const html = hello.modes.browser.sections.map((s) => s.html).join("\n");
  assert.match(html, /data-pane="temporal"/);
  assert.match(html, /data-run="\[&quot;uv run hello-worker&quot;\]" data-target="worker"/);
  // A trip's button stands alone: the command beside it would only repeat it.
  assert.match(html, /<div class="trip-run"><span class="trip-toggle" data-trip="SFO JFK"[^>]*>.*?<\/span><\/span><\/div>/);
  assert.ok(!html.includes("trip-cmd") && !html.includes("<code>uv run hello-start"), "no hello-start command beside its button");
  // "Open the link" opens that trip's workflow.
  assert.match(html, /<button class="workflow-link" type="button" data-workflow-open="hello-sfo-jfk-"/);
  // Step 0 starts the sandbox; the plain worker command block after "start the worker" is gone.
  assert.match(html, /<button class="sandbox-start" type="button" data-sandbox-start>Start my sandbox<\/button>/);
  assert.ok(!/<code>uv run hello-worker\n<\/code>/.test(html), "no plain worker block beside the toggle");
  assert.match(html, /In one terminal, start the worker<button class="worker-toggle"[^>]*>[\s\S]*?<\/button> and leave it running\./);
  assert.match(html, /<code>FLAKY=1 uv run hello-worker\n<\/code>/);
  assert.match(html, /data-run="\[&quot;FLAKY=1 uv run hello-worker&quot;\]" data-target="worker"/);
  assert.match(html, /class="file-ref" data-file="hello\/workflow.py"/);
  const local = hello.modes.local.sections.map((s) => s.html).join("\n");
  assert.ok(!local.includes("data-run"), "local snippets only copy");
});

test("a master's TODO blocks are the exact starter and solution lines for its chapter", async () => {
  const { todoBlocks } = await import("../content/build.mjs");
  const master = "a\n    # @@solution ch02\n    return 2\n    # @@starter\n    # TODO(ch02)\n    raise X\n    # @@end\n    # @@solution ch03\n    three\n    # @@starter\n    todo3\n    # @@end\nb";
  assert.deepEqual(todoBlocks(master, 2), [{ starter: "    # TODO(ch02)\n    raise X\n", solution: "    return 2\n" }]);
  assert.deepEqual(todoBlocks(master, 1), []);
  // Two in one file: each its own block.
  const two = "# @@solution ch02\nA = 1\n# @@starter\nA = 0\n# @@end\nx\n# @@solution ch02\nB = 1\n# @@starter\nB = 0\n# @@end\n";
  assert.deepEqual(todoBlocks(two, 2), [{ starter: "A = 0\n", solution: "A = 1\n" }, { starter: "B = 0\n", solution: "B = 1\n" }]);
});

test("every exercise's TODO block is in its starter, and its snippet replaces it", async () => {
  const { insertMode } = await import("../content/build.mjs");
  for (const exercise of buildCourse().exercises) {
    for (const file of exercise.files) {
      for (const todo of file.todos) {
        assert.ok(file.starter.includes(todo.starter), `${exercise.id}: a TODO block isn't in the starter of ${file.path}`);
        assert.ok(file.solution.includes(todo.solution), `${exercise.id}: a solution block isn't in the solution of ${file.path}`);
      }
      if (!file.todos.length) continue;
      const html = exercise.modes.browser.sections.map((s) => s.html).join("\n");
      assert.match(html, new RegExp(`data-insert="${file.path}" data-insert-mode="todo"`), `${exercise.id}: no snippet replaces the TODO`);
    }
  }
  assert.equal(insertMode("permit (x);", [{ solution: "forbid (y);" }], "policies/travel.dw"), "append");
  assert.equal(insertMode("x = 1", null, "a.py"), "cursor");
  const policy = 'permit (a);\n\n// why\n@id("hotels")\nforbid (x)\nunless {\n  y\n};\n';
  assert.equal(insertMode('@id("hotels")\n@decision("escalate")\nforbid (x);', null, "policies/travel.dw", policy), "replace");
  assert.equal(insertMode('@id("new-rule")\nforbid (z);', null, "policies/travel.dw", policy), "append");
  assert.equal(insertMode("return f(a)  # why", [{ solution: "    # because\n    return f(a)\n" }], "a.py"), "todo");
});

test("local pages have no insert buttons", () => {
  for (const exercise of buildCourse().exercises) {
    const html = exercise.modes.local.sections.map((s) => s.html).join("\n");
    assert.ok(!html.includes("data-insert"), exercise.id);
  }
});

test("in the browser, every mention of stopping or starting the worker gets the toggle, except in headings", () => {
  const hello = buildCourse().exercises[0];
  const html = hello.modes.browser.sections.map((s) => s.html).join("\n");
  const toggles = html.match(/data-worker-toggle/g) ?? [];
  assert.ok(toggles.length >= 5, `only ${toggles.length} toggles`);
  assert.match(html, /stop the worker \(Ctrl-C\)<button class="worker-toggle"/);
  assert.doesNotMatch(html, /<h2>[^<]*<button class="worker-toggle"/);
  const local = hello.modes.local.sections.map((s) => s.html).join("\n");
  assert.ok(!local.includes("data-worker-toggle"), "local pages have no toggles");
});

test("in the browser, a quoted message for the agent is a send button; locally it stays a quote", () => {
  const session = buildCourse().exercises.find((e) => e.id.startsWith("02"));
  const html = session.modes.browser.sections.map((s) => s.html).join("\n");
  assert.match(html, /<button class="agent-prompt" type="button" data-send="I need a flight from SFO to JFK next month\."/);
  assert.ok(!html.includes("<blockquote>"), "no quotes left in the browser");
  const local = session.modes.local.sections.map((s) => s.html).join("\n");
  assert.ok(!local.includes("data-send"), "local pages have no send buttons");
  assert.match(local, /<blockquote>\s*<p>I need a flight from SFO to JFK next month\.<\/p>/);
});

test("after \"restart the worker\" comes a restart button, except with something to set (FLAKY=1)", () => {
  const exercises = buildCourse().exercises;
  const hello = exercises[0].modes.browser.sections.map((s) => s.html).join("\n");
  const session = exercises[1].modes.browser.sections.map((s) => s.html).join("\n");
  assert.match(session, /Restart the worker<button class="worker-toggle" type="button" data-worker-toggle data-worker-restart>/);
  assert.match(hello, /Restart the worker<button class="worker-toggle" type="button" data-worker-toggle>[\s\S]*? with <code/);
  assert.match(hello, /stop the worker \(Ctrl-C\)<button class="worker-toggle" type="button" data-worker-toggle>/);
});

test("in the browser, every new session the instructions ask for is a button with its posture", () => {
  const exercises = buildCourse().exercises;
  const all = (mode) => exercises.map((e) => e.modes[mode].sections.map((s) => s.html).join("\n")).join("\n");
  const postures = [...all("browser").matchAll(/data-new-session="Travel agent" data-posture="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(postures, ["dangerously_skip_all", "human_approval_only", "approve_bookings", "auto_mode", "auto_mode", "dangerously_skip_all"]);
  assert.ok(!all("local").includes("data-new-session"), "local pages have no session buttons");
  assert.match(all("local"), /Start a new <strong>Travel agent<\/strong> session\. The start form/);
});

test("in the browser, the Agent UI comes with a tour, from a button; locally, from its URL", () => {
  const session = buildCourse().exercises.find((e) => e.id.startsWith("02"));
  const html = session.modes.browser.sections.map((s) => s.html).join("\n");
  assert.match(html, /<button class="pane-button" type="button" data-agent-tour>✦ Take a tour of the Agent UI<\/button>/);
  assert.ok(!html.includes("localhost:8000"), "no localhost URL in the browser");
  const local = session.modes.local.sections.map((s) => s.html).join("\n");
  assert.match(local, /Open it at <a href="http:\/\/localhost:8000"/);
  assert.ok(!local.includes("pane-button"), "no pane button locally");
});

test("an inserted snippet is found again, however it's indented, and not once it's edited", async () => {
  const { findSnippet, indentLines, dedent } = await import("../web/src/snippets.js");
  const code = "# why\nreturn f(\n    a,\n)\n";
  const file = `def g():\n${indentLines(dedent(code), "    ")}\n\nmore\n`;
  const found = findSnippet(file, code);
  assert.ok(found);
  assert.equal(file.slice(found.start, found.end), "    # why\n    return f(\n        a,\n    )");
  assert.equal(findSnippet(file.replace("a,", "b,"), code), null);
  assert.equal(findSnippet("", code), null);
});

test("every insertable snippet explains itself with comments, and still replaces its TODO", () => {
  for (const exercise of buildCourse().exercises) {
    const html = exercise.modes.browser.sections.map((s) => s.html).join("\n");
    for (const m of html.matchAll(/data-insert-mode="(\w+)"[\s\S]*?<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)) {
      const code = m[2].replace(/<[^>]+>/g, "");
      assert.match(code, /(^|\n)\s*(#|\/\/) |\s(#|\/\/) /, `${exercise.id}: a snippet without comments`);
    }
  }
});

test("in the browser, a command in prose gets a run button; a command with a placeholder doesn't", async () => {
  const { isInlineCommand } = await import("../content/build.mjs");
  assert.ok(isInlineCommand("uv run hello-start SEA LHR"));
  assert.ok(isInlineCommand("FLAKY=1 uv run hello-worker"));
  assert.ok(!isInlineCommand("temporal workflow show -w <workflow-id>"));
  assert.ok(!isInlineCommand("hello/workflow.py"));
  const hello = buildCourse().exercises[0];
  const html = hello.modes.browser.sections.map((s) => s.html).join("\n");
  assert.match(html, /Start a trip: <span class="trip-toggle" data-trip="SEA LHR"/);
  assert.match(html, /<code>FLAKY=1 uv run hello-worker<\/code><button class="cmd-run"|data-run="\[&quot;FLAKY=1 uv run hello-worker&quot;\]"/);
  assert.ok(!hello.modes.local.sections.map((s) => s.html).join("\n").includes("cmd-run"));
});

test("in the browser, \"Temporal UI\" in prose opens the pane; not in headings or locally", () => {
  const hello = buildCourse().exercises[0];
  const html = hello.modes.browser.sections.map((s) => s.html).join("\n") + hello.modes.browser.intro;
  assert.match(html, /open the <strong><a href="#" class="pane-ref" data-pane="temporal" data-path="\/"[^>]*>Temporal UI<\/a><\/strong>/);
  assert.match(html, /the two terminals and the <a href="#" class="pane-ref" data-pane="temporal"[^>]*>Temporal UI<\/a> on the left/);
  // A workflow to look at is a link to it, on the tab the step needs.
  assert.match(html, /data-workflow-open="hello-lax-ord-" data-workflow-tab="pending-activities"/);
  assert.match(html, /data-workflow-open="board-sfo-jfk-" data-workflow-tab="query"/);
  // ...never "open the workflow in the UI" and leave the learner to find it.
  for (const exercise of buildCourse().exercises) {
    const text = exercise.modes.browser.sections.map((s) => s.html).join("\n").replace(/<[^>]+>/g, "");
    assert.ok(!/open the (?:workflow|session|`?board)[^.:]{0,40} in the (?:Temporal )?UI/i.test(text), `${exercise.id}: a workflow to find by hand`);
  }
  assert.doesNotMatch(html, /<h\d[^>]*>[^<]*<a [^>]*pane-ref/);
  const local = hello.modes.local.sections.map((s) => s.html).join("\n");
  assert.ok(!local.includes("pane-ref"));
});

test("every exercise has a code tour, and every stop is found in its file, in a chunk that fits", async () => {
  const { tourRange } = await import("../web/src/tourRange.js");
  for (const exercise of buildCourse().exercises) {
    assert.ok(exercise.tour.length >= 3, `${exercise.id} has a code tour`);
    for (const stop of exercise.tour) {
      const file = exercise.files.find((f) => f.path === stop.file);
      const range = tourRange(file.starter, stop);
      assert.ok(range && range.end - range.start < 30, `${exercise.id}: ${stop.title} is ${range ? range.end - range.start + 1 : "no"} lines`);
      assert.ok(stop.html && !stop.html.includes("<p>"), `${stop.title} is inline Markdown`);
    }
  }
});

test("a tour stop takes its block, or runs to the next blank line, and follows edits", async () => {
  const { tourRange } = await import("../web/src/tourRange.js");
  const py = ["x = 1", "", "@decorator", "async def f(a):", "    one", "", "    two", "", "def g():", "    pass"].join("\n");
  assert.deepEqual(tourRange(py, { from: "@decorator" }), { start: 3, end: 7 });
  assert.deepEqual(tourRange(py, { from: "x = 1" }), { start: 1, end: 1 });
  assert.deepEqual(tourRange(py, { from: "async def f", to: "one" }), { start: 4, end: 5 });
  // A learner's edit took the `to` line away: the block instead, unless strict.
  assert.deepEqual(tourRange(py, { from: "async def f", to: "raise" }), { start: 4, end: 7 });
  assert.equal(tourRange(py, { from: "async def f", to: "raise" }, { strict: true }), null);
  assert.equal(tourRange(py, { from: "nowhere" }), null);
  const cedar = ['@id("a")', "permit (", "  x", ");", "", '@id("b")'].join("\n");
  assert.deepEqual(tourRange(cedar, { from: '@id("a")' }), { start: 1, end: 4 });
});

test("a policy rule is found by its @id, with the comments right above it, through its `};`", async () => {
  const { ruleBlock, ruleId } = await import("../web/src/snippets.js");
  const text = 'permit (a);\n\n// why\n@id("hotels")\nforbid (x)\nunless {\n  y\n};\n\n@id("other")\nforbid (z);\n';
  assert.equal(ruleId('// c\n@id("hotels")\nforbid (x);'), "hotels");
  const block = ruleBlock(text, "hotels");
  assert.equal(text.slice(block.start, block.end), '// why\n@id("hotels")\nforbid (x)\nunless {\n  y\n};');
  assert.equal(ruleBlock(text, "missing"), null);
});
