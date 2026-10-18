// Playwright's JSON results (reports/results.json) → a short report:
//
//   reports/summary.md     for the GitHub job summary, or a terminal
//   reports/email.json     an HTML email as Resend's POST /emails body, when E2E_MAIL_FROM and
//                          E2E_MAIL_TO (comma-separated) are set. Send it with
//                          curl https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" \
//                            -H "Content-Type: application/json" --data @reports/email.json
//
// Links come from E2E_RUN_URL (the CI run, with the HTML report attached). Prints the subject.
//
//   node scripts/summary.mjs [results.json]
import fs from "node:fs";
import path from "node:path";

import { BASE_URL } from "../env.mjs";

const file = process.argv[2] ?? "reports/results.json";
const outDir = path.dirname(file);
const runUrl = process.env.E2E_RUN_URL || "";

let report;
try {
  report = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (err) {
  // No results at all: the run broke before Playwright reported (an install step, say).
  report = { suites: [], stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 0 }, errors: [{ message: `No results (${err.message})` }] };
}

const stripAnsi = (s) => String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Every test, flattened: { title, tags, status, duration, error }.
function collect(suite, trail = [], out = []) {
  const here = suite.file && suite.title === suite.file ? trail : [...trail, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.at(-1) ?? {};
      const error = last.error?.message ?? last.errors?.[0]?.message ?? "";
      out.push({
        title: [...here, spec.title].join(" › "),
        tags: spec.tags ?? [],
        status: t.status, // expected | unexpected | flaky | skipped
        duration: (t.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0),
        error: stripAnsi(error).split("\n").filter((l) => l.trim()).slice(0, 6).join("\n"),
      });
    }
  }
  for (const child of suite.suites ?? []) collect(child, here, out);
  return out;
}

const tests = (report.suites ?? []).flatMap((s) => collect(s));
const stats = report.stats ?? {};
const failed = tests.filter((t) => t.status === "unexpected");
const flaky = tests.filter((t) => t.status === "flaky");
const passed = tests.filter((t) => t.status === "expected");
const skipped = tests.filter((t) => t.status === "skipped");
const globalErrors = (report.errors ?? []).map((e) => stripAnsi(e.message ?? e.value ?? e).split("\n")[0]);
const ok = failed.length === 0 && globalErrors.length === 0 && passed.length > 0;

// Which tiers ran: a tier is "skipped" when every one of its tests skipped (no secret for it).
const tiers = ["@public", "@auth", "@sandbox"].map((tag) => {
  const mine = tests.filter((t) => t.tags.includes(tag.slice(1)) || t.tags.includes(tag));
  const state = !mine.length ? "absent" : mine.some((t) => t.status === "unexpected") ? "failed" : mine.every((t) => t.status === "skipped") ? "skipped" : "passed";
  return { tag, state, count: mine.length };
});

const minutes = ((stats.duration ?? 0) / 60000).toFixed(1);
const date = new Date(stats.startTime ?? Date.now()).toISOString().slice(0, 10);
const host = new URL(BASE_URL).host;
const subject = ok
  ? `✅ Course e2e passed · ${host} · ${date}`
  : `❌ Course e2e: ${failed.length || globalErrors.length} failing · ${host} · ${date}`;
const counts = `${passed.length} passed, ${failed.length} failed, ${flaky.length} flaky, ${skipped.length} skipped · ${minutes} min`;
const tierIcon = { passed: "✅", failed: "❌", skipped: "⏭️", absent: "—" };

// --- Markdown ---------------------------------------------------------------------------------

const md = [
  `## ${subject}`,
  "",
  `${counts} · against ${BASE_URL}`,
  "",
  `| Tier | Result | Tests |`,
  `|---|---|---:|`,
  ...tiers.map((t) => `| \`${t.tag}\` | ${tierIcon[t.state]} ${t.state} | ${t.count} |`),
  "",
  ...(globalErrors.length ? ["### Run errors", "", ...globalErrors.map((e) => `- ${e}`), ""] : []),
  ...(failed.length ? ["### Failed", "", ...failed.flatMap((t) => [`- **${t.title}**`, "", "  ```", ...t.error.split("\n").map((l) => `  ${l}`), "  ```", ""])] : []),
  ...(flaky.length ? ["### Flaky (passed on retry)", "", ...flaky.map((t) => `- ${t.title}`), ""] : []),
  ...(runUrl ? [`[The run, with the HTML report, traces and screenshots](${runUrl})`] : []),
].join("\n");
fs.writeFileSync(path.join(outDir, "summary.md"), md + "\n");

// --- Email ------------------------------------------------------------------------------------

const from = process.env.E2E_MAIL_FROM;
const to = (process.env.E2E_MAIL_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (from && to.length) {
  const color = ok ? "#047857" : "#b91c1c";
  const row = (cells) => `<tr>${cells.map((c) => `<td style="padding:4px 12px 4px 0;border-bottom:1px solid #e5e7eb">${c}</td>`).join("")}</tr>`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:720px">
<h2 style="color:${color};margin-bottom:4px">${escape(subject)}</h2>
<p style="margin-top:0;color:#4b5563">${escape(counts)} · <a href="${escape(BASE_URL)}">${escape(BASE_URL)}</a></p>
<table style="border-collapse:collapse;font-size:14px">${row(["<b>Tier</b>", "<b>Result</b>", "<b>Tests</b>"])}${tiers
    .map((t) => row([`<code>${t.tag}</code>`, `${tierIcon[t.state]} ${t.state}`, String(t.count)]))
    .join("")}</table>
${globalErrors.length ? `<h3>Run errors</h3><ul>${globalErrors.map((e) => `<li>${escape(e)}</li>`).join("")}</ul>` : ""}
${failed.length ? `<h3 style="color:#b91c1c">Failed</h3>${failed.map((t) => `<p><b>${escape(t.title)}</b></p><pre style="background:#f3f4f6;padding:8px;white-space:pre-wrap;font-size:12px">${escape(t.error)}</pre>`).join("")}` : ""}
${flaky.length ? `<h3>Flaky (passed on retry)</h3><ul>${flaky.map((t) => `<li>${escape(t.title)}</li>`).join("")}</ul>` : ""}
${runUrl ? `<p><a href="${escape(runUrl)}">Open the run</a>: the HTML report, traces and screenshots are its artifacts.</p>` : ""}
</body></html>`;
  // The summary as plain text too, for mail clients that won't show HTML.
  fs.writeFileSync(path.join(outDir, "email.json"), JSON.stringify({ from, to, subject, html, text: md }));
}

console.log(subject);
