// Feedback: kept with where the learner was, checked, limited, emailed, and gone with its learner.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Accounts } from "../runner/accounts.mjs";
import { Activity, catalogOf } from "../runner/activity.mjs";
import { openDatabase } from "../runner/db.mjs";
import { cleanContext, Feedback, MAX_MESSAGE, whereText } from "../runner/feedback.mjs";
import { createMailer } from "../runner/mailer.mjs";

function setup() {
  const clock = { now: Date.parse("2026-11-10T09:00:00Z") };
  const now = () => clock.now;
  const db = openDatabase(":memory:");
  const activity = new Activity(db, { catalog: catalogOf(null), now });
  const record = (...args) => activity.record(...args);
  const accounts = new Accounts(db, { secret: "s", adminEmails: ["boss@temporal.io"], consoleSignIn: () => true, now, record });
  const feedback = new Feedback(db, { now, record });
  const { code } = accounts.startSignIn("jane@acme.com", "1.2.3.4");
  const user = accounts.verifySignIn("jane@acme.com", code);
  accounts.setProfile(user.id, { name: "Jane", role: "Architect" });
  return { clock, db, accounts, activity, feedback, user };
}

const WHERE = {
  page: "exercise",
  url: "#/module/A4",
  exerciseId: "02-durable-session",
  exerciseTitle: "Durable session",
  moduleId: "A4",
  moduleTitle: "Kill the worker",
  beatId: "3-restart-the-worker",
  beatTitle: "Restart the worker",
  sandbox: "ready",
  viewport: { width: 1440, height: 900 },
};

test("feedback is kept with who sent it and where they were, and logged as an event", () => {
  const { feedback, activity, user } = setup();
  const fb = feedback.add(user.id, { message: "  The check said I failed, but it passed.  ", kind: "bug", context: WHERE, userAgent: "Firefox" });
  assert.equal(fb.message, "The check said I failed, but it passed.");
  assert.deepEqual([fb.email, fb.name, fb.kind, fb.moduleId, fb.beatId, fb.exerciseId], ["jane@acme.com", "Jane", "bug", "A4", "3-restart-the-worker", "02-durable-session"]);
  assert.equal(fb.where, "Durable session › A4 · Kill the worker › step “Restart the worker”");
  assert.equal(fb.context.userAgent, "Firefox");
  assert.deepEqual(feedback.list().map((f) => f.id), [fb.id]);
  const event = activity.eventsOf(user.id).find((e) => e.type === "feedback_sent");
  assert.equal(event.module_id, "A4");
  assert.deepEqual(JSON.parse(event.data), { id: fb.id, kind: "bug" });
});

test("feedback needs words, under the limit, and a known kind", () => {
  const { feedback, user } = setup();
  assert.throws(() => feedback.add(user.id, { message: "   " }), { status: 400 });
  assert.throws(() => feedback.add(user.id, { message: "x".repeat(MAX_MESSAGE + 1) }), { status: 400 });
  assert.throws(() => feedback.add(user.id, { message: "hi", kind: "rant" }), { status: 400 });
  assert.equal(feedback.add(user.id, { message: "hi" }).kind, null, "the kind is optional");
});

test("the page's context is cleaned: unknown fields dropped, odd ids and long text cut", () => {
  const c = cleanContext({ page: "evil", moduleId: "A4; DROP TABLE", beatTitle: "x".repeat(500), secret: "nope", viewport: { width: "1200", height: 800 } });
  assert.equal(c.page, null);
  assert.equal(c.moduleId, null);
  assert.equal(c.beatTitle.length, 160);
  assert.equal("secret" in c, false);
  assert.deepEqual(c.viewport, { width: 1200, height: 800 });
  assert.deepEqual(cleanContext(null).page, null);
  assert.equal(whereText(cleanContext({ page: "home" })), "The map");
  assert.equal(whereText(cleanContext({ page: "home", moduleId: "F3", moduleTitle: "Restart" })), "F3 · Restart");
  assert.equal(whereText(cleanContext({ moduleId: "F3", moduleTitle: "Restart it", beatTitle: "3. Restart it" })), "F3 · Restart it", "a step titled like its module isn't repeated");
});

test("feedback is limited to 5 per learner in 10 minutes", () => {
  const { feedback, user, clock } = setup();
  for (let i = 0; i < 5; i++) feedback.add(user.id, { message: `note ${i}` });
  assert.throws(() => feedback.add(user.id, { message: "one more" }), { status: 429 });
  clock.now += 10 * 60_000 + 1;
  assert.ok(feedback.add(user.id, { message: "later" }).id);
});

test("deleting a learner deletes their feedback", () => {
  const { feedback, accounts, db, user } = setup();
  feedback.add(user.id, { message: "hi" });
  accounts.deleteUser(user.id, "boss@temporal.io");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feedback").get().n, 0);
});

test("feedback is emailed with the learner as reply-to, and where they were", async () => {
  const { feedback, user } = setup();
  const fb = feedback.add(user.id, { message: "Loved <the> boss fight", kind: "praise", context: WHERE });
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true };
  };
  const mailer = createMailer({ resendApiKey: "k", mailFrom: "Quest <q@x.dev>" }, { fetchImpl });
  await mailer.feedback(["tao.guo@temporal.io"], fb, "https://quest.dev");
  assert.equal(sent.length, 1);
  const [mail] = sent;
  assert.deepEqual(mail.to, ["tao.guo@temporal.io"]);
  assert.equal(mail.reply_to, "jane@acme.com");
  assert.match(mail.subject, /^\[praise\] Feedback from Jane: Durable session › A4/);
  assert.match(mail.text, /https:\/\/quest\.dev\/#\/module\/A4/);
  assert.match(mail.html, /Loved &lt;the&gt; boss fight/);
  await mailer.feedback([], fb, "https://quest.dev");
  assert.equal(sent.length, 1, "nobody to send to: nothing sent");
});
