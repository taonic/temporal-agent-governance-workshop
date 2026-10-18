// A learner at the course page, doing what the guide says: the guide's own buttons (Insert, ▶,
// the worker toggle, New session, the messages to send), the editor, both terminals, the Agent
// UI's approval cards and trip form, and the ✓ Check. The walkthroughs (walkthroughs.mjs) are
// written in these words, a step at a time, the way an assignment reads.
//
// The model is the sandbox's real one (Gemini), so the agent's next move isn't fixed: converse()
// answers whatever comes (an approval card, the trip form, a reply) until the turn is over, and
// reports what happened. The walkthroughs assert what the system guarantees (what the ledger
// holds, which tool waited for approval), not what the model said.
import { expect } from "@playwright/test";

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;

// The trip form's sample trip (travel_agent/agent: the form starts filled in with it).
export const SAMPLE_TRAVELER = "Ada Lovelace";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Learner {
  constructor(page, testInfo = null) {
    this.page = page;
    this.testInfo = testInfo;
    this.agent = page.frameLocator("iframe[title='The Agent UI']");
    this.temporal = page.frameLocator("iframe[title='The Temporal UI']");
  }

  // Something the instructions say that the page doesn't do as written: in the report, without
  // failing the run.
  note(description) {
    this.testInfo?.annotations.push({ type: "instructions", description });
    console.log(`note: ${description}`);
  }

  // --- The workspace ------------------------------------------------------------------------

  async view(name) {
    const tab = this.page.getByRole("tab", { name, exact: true });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  }

  terminal(name) {
    return this.page.locator(`.terminal-pane[aria-label="The ${name} terminal"]`);
  }

  terminalText(name) {
    return this.terminal(name).locator(".xterm-rows");
  }

  // Types a line into a terminal and presses Enter. Keys typed while something else on the page
  // takes the focus are lost, so the line is checked on screen first (its end, as the shell echoes
  // it), and typed again on a cleared line if it isn't there.
  async type(name, line) {
    await this.view("Code");
    const tail = line.replace(/\s+/g, "").slice(-16);
    for (let attempt = 0; ; attempt++) {
      await this.terminal(name).locator(".terminal-host").click();
      await this.page.keyboard.press("Control+U");
      await this.page.keyboard.type(line);
      const shown = await expect
        .poll(async () => ((await this.terminalText(name).textContent()) ?? "").replace(/\s+/g, "").includes(tail), { timeout: 5 * SECOND })
        .toBe(true)
        .then(() => true, () => false);
      if (shown || attempt === 2) break;
    }
    await this.page.keyboard.press("Enter");
  }

  // A terminal's text, scrollback included, a line a row: xterm only draws the rows on screen,
  // so this scrolls back through it, as a learner would to read output that went by, and comes
  // back down. At most `pages` screens back.
  async terminalLines(name, { pages = 30 } = {}) {
    return this.terminal(name)
      .locator(".xterm-viewport")
      .evaluate(async (viewport, pages) => {
        const rows = viewport.closest(".terminal-pane").querySelector(".xterm-rows");
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rowHeight = rows.firstElementChild?.getBoundingClientRect().height || 1;
        const lines = new Map();
        let top = viewport.scrollHeight - viewport.clientHeight;
        for (let n = 0; n < pages; n++) {
          viewport.scrollTop = top;
          viewport.dispatchEvent(new Event("scroll"));
          await frame();
          const first = Math.round(viewport.scrollTop / rowHeight);
          [...rows.children].forEach((row, i) => lines.set(first + i, row.textContent.replace(/ /g, " ").trimEnd()));
          if (top <= 0) break;
          top = Math.max(0, top - viewport.clientHeight);
        }
        viewport.scrollTop = viewport.scrollHeight;
        viewport.dispatchEvent(new Event("scroll"));
        return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join("\n");
      }, pages);
  }

  // The last ▶'s output with the terminal's rows run together: a line longer than the terminal
  // is wrapped across rows, so a phrase in it is only whole this way.
  get flatOutput() {
    return (this.output ?? "").replace(/\n/g, "");
  }

  // What the terminal printed since the last time `command` was typed into it.
  async outputOf(name, command) {
    const text = await this.terminalLines(name);
    const at = text.lastIndexOf(command);
    return at >= 0 ? text.slice(at + command.length) : text;
  }

  // Waits for what's running in a terminal to finish, and returns its exit status: a marker
  // typed after it, which the shell only runs once the command before it is done. The marker it
  // waits for is built by the shell ($((…)), $?), so the typed line never matches it.
  async settle(name, { timeout = 2 * MINUTE } = {}) {
    const id = Math.floor(Math.random() * 1e6);
    await this.type(name, `echo e2e-$((${id}+1))-exit-$?`);
    const rows = this.terminalText(name);
    const marker = new RegExp(`e2e-${id + 1}-exit-(\\d+)`);
    await expect(rows).toContainText(marker, { timeout });
    return Number((await rows.textContent()).match(marker)[1]);
  }

  // --- The guide ----------------------------------------------------------------------------

  get guide() {
    return this.page.locator(".guide-panel");
  }

  // What the guide says now: the beat on screen.
  get body() {
    return this.guide.locator(".guide-msg .guide-body");
  }

  async openExercise(id) {
    await this.page.goto(`/#/exercise/${id}`);
    await expect(this.page.locator(".sandbox-pill"), "the sandbox isn't ready").toHaveText(/Sandbox ready/, { timeout: 3 * MINUTE });
  }

  // Each beat's message types itself out, heading too, and its replies wait for it: read once
  // it's done.
  async read() {
    await expect(this.guide.locator(".guide-bubble.is-streaming")).toHaveCount(0, { timeout: 30 * SECOND });
  }

  // The beat's heading. A passed check shows its 🎉 instead, with no heading: that's the check.
  async heading() {
    await this.read();
    if (await this.guide.locator(".guide-passed").isVisible()) return "Check your work";
    return (await this.guide.locator(".guide-title").textContent()).trim();
  }

  // The guide's reply that moves on (Let's start →, Done, next step →, Got it →…), past the
  // code tour.
  async advance() {
    await this.read();
    const replies = this.guide.locator(".guide-replies");
    await expect(replies).toBeVisible();
    const skipTour = replies.getByRole("button", { name: "Skip the code tour" });
    if (await skipTour.isVisible()) return skipTour.click();
    await replies.locator("button.guide-reply", { hasText: /→$/ }).last().click();
  }

  // On to the step with this title (as the assignment's heading has it, without its number),
  // with the guide's replies, as a learner goes. Fails if the guide gets to the check without it.
  // A check that passes mid-exercise (exercise 4 runs check.sh in a step) sends the guide to its
  // 🎉: then back to the step by its segment in the step bar, as a learner would.
  async step(title) {
    for (let i = 0; i < 40; i++) {
      const now = await this.heading();
      if (now === title) return;
      if (now === "Check your work") {
        // Its aria-label: "Go to step N: <title>".
        const segment = this.guide.locator(`.step-progress-seg[aria-label$=${JSON.stringify(`: ${title}`)}]`);
        if (await segment.count()) {
          await segment.first().click();
          continue;
        }
        throw new Error(`The guide has no step "${title}": did the assignment change? Update walkthroughs.mjs.`);
      }
      await this.advance();
    }
    throw new Error(`Never got to the step "${title}"`);
  }

  async toCheck() {
    for (let i = 0; i < 40 && (await this.heading()) !== "Check your work"; i++) await this.advance();
    expect(await this.heading()).toBe("Check your work");
  }

  // ↺ Start over, in the guide's header (and yes to its confirm): the exercise's reset.sh, in the
  // worker terminal. Its file back as the exercise starts, any earlier exercise whose TODO is
  // still open solved, sessions ended, the bookings ledger cleared, the check no longer passed;
  // a running worker started again on that code. The guide goes back to its first beat. So each
  // exercise starts the same way, whatever ran in the sandbox before (an earlier walkthrough that
  // failed, or the page catching up on earlier exercises when a later one is opened).
  //
  // The worker is stopped first (the dock's toggle): with it running, Start over types Ctrl-C
  // and then its command 900 ms later, and the travel worker takes longer than that to stop, so
  // the command is lost and reset.sh never runs (TerminalDock's type()).
  async startOver(exercise) {
    await this.view("Code"); // the dock, with its toggle, is under Code
    const dockToggle = this.page.locator(".dock-bar button.worker-toggle").first();
    // Stopped, and staying stopped: opening an exercise catches up earlier ones still open (a
    // walkthrough that failed), and the page restarts a running worker for that, a few seconds in.
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect.poll(() => this.workerState(), { timeout: MINUTE }).not.toMatch(/pending|unknown/);
      if ((await this.workerState()) === "running") {
        await dockToggle.click();
        await expect.poll(() => this.workerState(), { message: "the worker didn't stop", timeout: MINUTE }).toBe("stopped");
      }
      await sleep(6 * SECOND);
      if ((await this.workerState()) === "stopped") break;
    }
    await this.guide.getByRole("button", { name: /Start over/ }).click();
    await expect(this.terminalText("worker"), `${exercise}'s reset.sh didn't finish`).toContainText("Sessions ended and bookings cleared.", { timeout: 3 * MINUTE });
    await expect.poll(() => this.workerState(), { timeout: MINUTE }).not.toBe("pending");
    await expect(this.guide.locator(".guide-heading-title .passed-badge")).toHaveCount(0);
  }

  // ✓ Run the check, on the guide's last beat, and the passed badge.
  async check(exercise) {
    await this.toCheck();
    await this.guide.getByRole("button", { name: "✓ Run the check" }).click();
    await expect(this.guide.locator(".guide-heading-title .passed-badge"), `${exercise}'s check didn't pass`).toBeVisible({ timeout: 5 * MINUTE });
  }

  // --- The step's buttons -------------------------------------------------------------------

  // The step's ▶ for a command (or the first of a block of commands), clicked. Unless it's
  // long-running (a worker, a follow), waits for it and returns its exit status; what it printed
  // is in this.output.
  async runButton(command, { wait = true, timeout = 2 * MINUTE } = {}) {
    const buttons = this.body.locator("button[data-run]");
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const commands = JSON.parse(await button.getAttribute("data-run"));
      if (commands[0] !== command) continue;
      await button.click();
      if (!wait) return null;
      const target = await button.getAttribute("data-target");
      const status = await this.settle(target, { timeout });
      this.output = await this.outputOf(target, command);
      return status;
    }
    throw new Error(`The step has no ▶ for \`${command}\``);
  }

  workerToggle() {
    return this.body.locator("button[data-worker-toggle]:not([data-worker-restart])").first();
  }

  async workerState() {
    // The dock's toggle, beside ✓ Check: always there, whatever the guide shows.
    const toggle = this.page.locator(".dock-bar button.worker-toggle").first();
    const state = (await toggle.getAttribute("class"))?.match(/\bis-(running|stopped|pending|unknown)\b/)?.[1];
    return state ?? "unknown";
  }

  // The step's worker toggle, clicked until the worker is running (or stopped).
  async worker(want) {
    const toggle = this.workerToggle();
    await expect(toggle, "the step has no worker toggle").toBeVisible();
    await expect(toggle).not.toHaveClass(/\bis-(pending|unknown)\b/, { timeout: 30 * SECOND });
    if (!(await toggle.getAttribute("class")).includes(`is-${want}`)) await toggle.click();
    await expect(toggle, `the worker didn't end up ${want}`).toHaveClass(new RegExp(`\\bis-${want}\\b`), { timeout: MINUTE });
  }

  // The step's Restart (after "restart the worker"): Ctrl-C and start again, in one click.
  async restartWorker() {
    const restart = this.body.locator("button[data-worker-restart]").first();
    await expect(restart, "the step has no worker restart").toBeVisible();
    await expect(restart).not.toHaveClass(/\bis-(pending|unknown)\b/, { timeout: 30 * SECOND });
    await restart.click();
    await expect(restart, "the worker didn't come back").toHaveClass(/\bis-running\b/, { timeout: MINUTE });
  }

  // Clicks the step's nth Insert, and waits for the snippet to be in the file, saved to the
  // sandbox (read back through the runner, as the worker will).
  async insert(n = 0) {
    const button = this.body.locator("button[data-insert]").nth(n);
    const path = await button.getAttribute("data-insert");
    // The snippet's code, found as the page finds it (ExerciseInstructions' snippetCode).
    const code = await button.evaluate((b) => b.closest(".snippet")?.querySelector("pre")?.innerText ?? "");
    await button.click();
    await expect(button, `the snippet didn't go into ${path}`).toHaveClass(/\bis-inserted\b/, { timeout: 15 * SECOND });
    // A line of code from the snippet, not a comment: in the file the sandbox has.
    const line = code
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.startsWith("//"));
    await expect.poll(() => this.readFile(path), { message: `${path} wasn't saved to the sandbox`, timeout: 30 * SECOND }).toContain(line);
    return path;
  }

  // A file name in the step (code.file-ref), opened in the editor.
  // The step's ✦ Take a tour of the Agent UI, all the way through: the Agent UI over the whole
  // screen, then each of the tour's cards (it skips the ones whose target isn't on screen). Back
  // to Code after, so the guide is there again. Returns the titles of the cards it showed.
  async agentTour() {
    await this.body.locator("button[data-agent-tour]").click();
    await expect(this.page.getByRole("tab", { name: "Agent UI", exact: true }), "the tour didn't open the Agent UI").toHaveAttribute("aria-selected", "true");
    const tour = this.page.getByRole("dialog", { name: "Product tour" });
    await expect(tour, "the Agent UI's tour didn't start").toBeVisible({ timeout: 30 * SECOND });
    // Its cards find their targets as they come: wait for the Agent UI itself first.
    await expect(this.agent.locator("button.session-drawer-trigger"), "the Agent UI didn't load").toBeVisible({ timeout: MINUTE });
    const titles = [];
    for (let i = 0; i < 20 && (await tour.isVisible()); i++) {
      titles.push((await tour.locator(".tour-title").textContent()).trim());
      await tour.locator(".tour-nav .button-primary").click();
      await sleep(300);
    }
    await expect(tour, "the tour never finished").toBeHidden();
    await this.view("Code");
    return titles;
  }

  async openFile(path) {
    await this.body.locator(`code.file-ref[data-file="${path}"]`).first().click();
    await expect(this.page.locator(".file-tab.active")).toContainText(path.split("/").pop());
  }

  // Puts the editor's cursor on the line that starts with `text` (after its indentation): with
  // select, the whole line selected, from its first column, the way a cursor Insert replaces it.
  async cursorOn(text, { select = false } = {}) {
    await this.view("Code");
    const line = this.page.locator(".cm-content .cm-line", { hasText: text }).first();
    await line.click();
    await this.page.keyboard.press("Home");
    await this.page.keyboard.press("Home");
    if (select) await this.page.keyboard.press("Shift+End");
  }

  // --- Exercise 1's trips and the Temporal UI -------------------------------------------------

  trip(key) {
    return this.body.locator(`[data-trip="${key}"]`);
  }

  async startTrip(key) {
    const trip = this.trip(key);
    await trip.locator("button[data-trip-act='start']").click();
    await expect(trip, `the ${key} trip didn't start`).toHaveClass(/\bis-running\b/, { timeout: 30 * SECOND });
  }

  // The step's button that opens a session's (or a workflow's) page in the Temporal UI, and the
  // page it opened.
  async openInTemporal(selector) {
    await this.body.locator(selector).first().click();
    await expect(this.page.getByRole("tab", { name: "Temporal UI", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => this.page.frames().some((f) => /\/namespaces\/[^/]+\/workflows\/./.test(f.url())), {
      message: `${selector} didn't open a workflow in the Temporal UI`,
      timeout: 30 * SECOND,
    }).toBe(true);
  }

  // --- The Agent UI -------------------------------------------------------------------------

  // The step's New session ▸ (the start form, with its posture chosen), and Start session. The
  // console lists the agent as disabled until its worker answers, so a click too early is tried
  // again.
  async newSession(posture) {
    const button = this.body.locator(`button[data-new-session][data-posture="${posture}"]`).first();
    const sheet = this.agent.locator("dialog.start-sheet[open]");
    for (let attempt = 0; attempt < 6 && !(await sheet.isVisible()); attempt++) {
      await button.click();
      await sheet.waitFor({ state: "visible", timeout: 10 * SECOND }).catch(() => {});
    }
    await expect(sheet, "the start form didn't open: is the worker running?").toBeVisible();
    await expect(sheet.locator("select").first()).toHaveValue(posture);
    await sheet.getByRole("button", { name: "Start session" }).click();
    await expect(sheet).toBeHidden({ timeout: 30 * SECOND });
    await expect(this.composer, "the new session never took messages").toBeEnabled({ timeout: MINUTE });
  }

  get composer() {
    return this.agent.locator("form.composer input");
  }

  // Sends a message: the step's button for it if it has one, else typed into the Agent UI.
  async send(text) {
    await this.view("Agent UI");
    const buttons = this.body.locator("button[data-send]");
    let button = null;
    for (let i = 0; i < (await buttons.count()) && !button; i++) {
      if ((await buttons.nth(i).getAttribute("data-send")) === text) button = buttons.nth(i);
    }
    if (button) await button.click();
    else {
      await expect(this.composer).toBeEnabled({ timeout: MINUTE });
      await this.composer.fill(text);
      await this.composer.press("Enter");
    }
    await expect(this.agent.locator(".message-list"), "the message didn't show in the chat").toContainText(text, { timeout: 30 * SECOND });
  }

  // The cards waiting on the learner: an approval with its buttons enabled, a form not yet sent.
  // Only the cards on screen: the Agent UI keeps others (another session's, a panel's) hidden.
  approvalCards() {
    return this.agent
      .locator(".pending-approval-card")
      .filter({ visible: true })
      .filter({ has: this.agent.locator("button:not([disabled])", { hasText: "Approve" }) });
  }

  formCards() {
    return this.agent.locator(".pending-callback-card").filter({ visible: true }).filter({ has: this.agent.locator("button.send:not([disabled])") });
  }

  approvalCard() {
    return this.approvalCards().first();
  }

  formCard() {
    return this.formCards().first();
  }

  // The Agent UI's open session: in its address (?s=), else in the local storage it shares with
  // the page (as SandboxPanes' openSession finds it).
  async sessionId() {
    const frame = this.page.frames().find((f) => f.url().includes("/sbx/console"));
    const fromUrl = frame ? new URL(frame.url()).searchParams.get("s") : null;
    if (fromUrl) return fromUrl;
    return this.page.evaluate(() => localStorage.getItem("temporal-agent-ui.active-session.v1")).catch(() => null);
  }

  // The session's agent_status query, through the console's own API (what the Agent UI reads).
  async agentStatus() {
    const id = await this.sessionId();
    if (!id) return null;
    const res = await this.page.request.get(`/sbx/console/api/status/${encodeURIComponent(id)}`).catch((err) => err);
    if (!res?.ok?.()) {
      if (!this.statusWarned) console.log(`agent status for ${id}: ${res?.status?.() ?? res?.message}`);
      this.statusWarned = true;
      return null;
    }
    return res.json();
  }

  // Working: a turn is open (turn_active stays true while any part of it runs) or another is
  // queued. The screen can't say: the composer stays enabled, and State flow's badges keep
  // animating after a turn ends.
  async busy() {
    const status = await this.agentStatus();
    if (status) return Boolean(status.turn_active || status.pending_turns?.length);
    return (await this.agent.locator(".bubble.thinking").count()) > 0;
  }

  // Sends a message and sees the turn through: each approval card goes to onApproval(card,
  // tool) (approve all, by default), each trip form to onForm(card) (sent as it is, by default),
  // until the agent has been quiet for a few seconds. What happened: { approvals: [tool…],
  // forms, reply }.
  async converse(text, options = {}) {
    await this.send(text);
    return this.untilQuiet(options);
  }

  // The cards answered as they come, until the agent is quiet, or until until() says so (a turn
  // that waits on a broken tool is never quiet).
  async untilQuiet({ onApproval = approve, onForm = submitForm, until = null, timeout = 4 * MINUTE, quietMs = 8 * SECOND } = {}) {
    const happened = { approvals: [], forms: 0, reply: "" };
    const deadline = Date.now() + timeout;
    let quietSince = null;
    await this.view("Agent UI");
    while (Date.now() < deadline) {
      const card = this.approvalCard();
      if (await card.isVisible()) {
        // The card's head: the tool's name, and what it's for. A card can go as it's read (the
        // agent moved on): then there's nothing to answer.
        const head = await card.locator(".pending-approval-head").textContent({ timeout: 3 * SECOND }).catch(() => null);
        if (head === null) continue;
        const tool = head.replace(/\s+/g, " ").trim();
        happened.approvals.push(tool);
        await onApproval(card, tool, this);
        quietSince = null;
        continue;
      }
      const form = this.formCard();
      if (await form.isVisible()) {
        happened.forms++;
        await onForm(form, this);
        quietSince = null;
        continue;
      }
      if (until && (await until())) {
        happened.reply = (await this.lastReply()) ?? "";
        return happened;
      }
      if (await this.busy()) quietSince = null;
      else if (!until && (quietSince ??= Date.now()) + quietMs < Date.now()) {
        happened.reply = (await this.lastReply()) ?? "";
        const status = await this.agentStatus();
        console.log(
          `turn over: session ${await this.sessionId()}, turn ${status?.current_turn} active ${status?.turn_active}, ` +
            `approvals ${happened.approvals.join(", ") || "none"}, forms ${happened.forms}; reply: ${happened.reply.slice(0, 160).replace(/\s+/g, " ")}`,
        );
        return happened;
      }
      await sleep(500);
    }
    throw new Error(`The agent's turn didn't finish within ${timeout / SECOND}s (approvals so far: ${happened.approvals.join(", ") || "none"})`);
  }

  async lastReply() {
    const replies = this.agent.locator(".message.assistant .bubble:not(.thinking)");
    const count = await replies.count();
    return count ? (await replies.nth(count - 1).innerText()).trim() : null;
  }

  // --- The sandbox's files ------------------------------------------------------------------

  // A file in the sandbox's workshop, through the runner the editor reads with ("" if it isn't there).
  async readFile(path) {
    const res = await this.page.request.get(`/api/files?path=${encodeURIComponent(path)}`);
    if (!res.ok()) return "";
    return (await res.json()).content ?? "";
  }

  // The bookings ledger (.data/bookings.json), as a list: { type: "flight" | "hotel", … }.
  async bookings() {
    const text = await this.readFile(".data/bookings.json");
    return text ? Object.values(JSON.parse(text)) : [];
  }
}

// The default answers to the agent's cards. A card locator finds the first card still waiting,
// so once one is answered it moves on to the next: the card is known by its text instead, and
// answered once it's no longer among the waiting ones (gone, or its buttons disabled). With
// settle false, the click is all (an approval that waits for a worker).
// The Agent UI redraws a card as the session streams, so a click can land on one that's just
// been replaced: it's tried again while the card still waits.
// A click that lands mid-redraw can be lost: if the card still waits a few seconds later, it's
// clicked again (a second answer to the same call is turned away, harmlessly).
async function answer(card, button, waiting, { settle = true } = {}) {
  const text = await card.innerText();
  const stillWaiting = async () => (await waiting.allInnerTexts()).includes(text);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await button().click({ timeout: 10 * SECOND });
    } catch (err) {
      if (!(await stillWaiting())) return;
      if (attempt === 3) throw err;
      continue;
    }
    if (!settle) return;
    const deadline = Date.now() + 8 * SECOND;
    while (Date.now() < deadline) {
      if (!(await stillWaiting())) return;
      await sleep(500);
    }
  }
  throw new Error(`The card still waits after four clicks: ${text.slice(0, 120)}`);
}

// The same card again, by the tool call's id it shows (a UUID), or its tool's name.
async function sameCard(card, waiting) {
  const text = await card.innerText();
  const id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? text.split("\n")[0];
  return () => waiting.filter({ hasText: id }).first();
}

export async function approve(card, _tool, learner, options) {
  const again = await sameCard(card, learner.approvalCards());
  await answer(card, () => again().getByRole("button", { name: "Approve", exact: true }), learner.approvalCards(), options);
}

export async function reject(card, _tool, learner, options) {
  const again = await sameCard(card, learner.approvalCards());
  await answer(card, () => again().getByRole("button", { name: "Reject", exact: true }), learner.approvalCards(), options);
}

// The trip form, sent as it starts (the sample trip), or for another traveler.
export async function submitForm(card, learner, { traveler } = {}) {
  if (traveler) {
    const inputs = card.locator("input");
    for (let i = 0; i < (await inputs.count()); i++) {
      if ((await inputs.nth(i).inputValue()) === SAMPLE_TRAVELER) await inputs.nth(i).fill(traveler);
    }
  }
  await answer(card, () => card.locator("button.send"), learner.formCards());
}
