# The browser course

A website for the workshop: every exercise's instructions, and, for signed-in learners, their own cloud sandbox to do it in. It's the same workshop as the rest of this repo; the site is generated from it.

- **The map** is open to anyone, and so is the setup guide. **The modules** need a sign-in: a learner's work email and a 6-digit code sent to it, for emails on the allowlist (a cohort's, or a company's domain). Others with a company email can ask for access. Progress is kept on the server, so it follows a learner across browsers. (The content is still in the public repo and the site's bundle: the sign-in is for knowing who's learning, not for secrecy.)
- **`/admin`**, for `ADMIN_EMAILS`: cohorts and the allowlist, access requests, each learner's journey (where they are, what they passed, how long it took, anyone stuck), the activity log, the learners' feedback, and the sandboxes.
- **The Derby**, a live race through Essentials for a room (an offsite, a workshop). An admin makes a race in `/admin` → **Events**: it gets a join code (`DERBY42`), a join link with its QR (`/join/DERBY42`), and a race screen for the projector (`/race/<slug>`, no sign-in). People join with the code, a name and a jockey they build (a creature, silks, a horse name), and no email; a pit-pass gets them back in on another device. The race screen shows each racer as a horse as far down a track marked in XP as their XP (the finish line is a perfect score), with standings, commentary and sound; the host starts it, adds time, ends it and reveals the podium from the Events tab (on a phone, not the projector), and can fill the field with scripted ghosts to rehearse. It rewards understanding over speed: a module's XP depends on its question being right the first time (as a challenge's does), and at the same XP fewer slips win, before the clock; only what's done between the gun and the finish counts. `runner/race.mjs`, `web/src/race/`; the design is `.scratch/cohort-race/spec.md`.
- **Feedback**, for anyone signed in: the top bar's Feedback button sends a note with where they are (the exercise, the module, the guide's step, or the map's node), kept in the database and emailed to `FEEDBACK_EMAILS`.
- **The browser runtime** gives each learner a [Daytona](https://www.daytona.io/) sandbox with everything installed and `travel-stack up` already run, and puts it in the page, laid out like the [loan-origination course](https://temporal-training-agentic-loan-origination.fly.dev): a workspace on the left (tabs for the exercise's code, the agent's console and the Temporal UI, one at a time at full width, over a dock with two real terminals side by side, `worker` and `commands`) and the guide on the right, which brings the right tab forward for each step.
- **Local** stays first-class: the setup page covers running it on your machine, and exercise pages show the local instructions when the browser runtime isn't available. (There was a Browser | Local switch; the guide's header has **↺ Start over** instead.)
- **The instructions are a guide**: a conversation that shows one step at a time. You say **Done, next step**, go **← Back**, or ask about the step you're on, and Ask Temporal answers right under it.
- **Ask Temporal** (⌘K / Ctrl+K, or the button in the top bar) answers questions about Temporal from Temporal's docs, through [Kapa's MCP server](https://temporal.mcp.kapa.ai), with links to the pages it used. It knows the exercise you're on, can see the file you have open, and takes a selection from the instructions, the editor or a terminal (select a traceback, click **✦ Ask**). It needs a sign-in, not a sandbox, so it works in Local mode too.

Hosting it: [DEPLOY.md](DEPLOY.md). Why it's built this way: [DESIGN.md](DESIGN.md).

## What's where

```
course/
  content/      build.mjs: the modules (../quests), README and starter/authoring files → web/src/generated/course-data.json
  web/          the Vue site (Vite): pages/, components/, store.js, styles.css
  runner/       the Node service: the /api, the sandboxes, the terminals, the proxies, the model passthrough,
                and Ask Temporal (helper.mjs; kapa.mjs and mcp.mjs talk to the docs). Accounts: db.mjs
                (SQLite), accounts.mjs (sign-in, the allowlist, cohorts, access requests), activity.mjs
                (events, progress, time on modules, sandbox time), admin.mjs (/api/admin), mailer.mjs,
                sweep.mjs (once a minute: sandbox time and the allowance)
  snapshot/     the sandbox image (Dockerfile), lsp_bridge.py (the editor's language server), and
                build.mjs, which builds it as a Daytona snapshot
  tests/        node --test: the content build, auth, accounts and activity, rate limits, the passthrough
  e2e/          Playwright against the deployed site, daily and after each deploy (e2e/README.md)
  Dockerfile    the site and runner, for Fly (built from the repo root)
  fly.toml
```

## Develop it

```bash
cd course
npm install
npm test
```

Two terminals:

```bash
# A: the runner. Without DAYTONA_API_KEY the site works, but only in Local mode.
# Without RESEND_API_KEY, sign-in codes are printed here and any email may sign in, from this
# machine only. ADMIN_EMAILS=you@… opens /admin to you.
DAYTONA_API_KEY=... GEMINI_API_KEY=... ADMIN_EMAILS=you@temporal.io npm run runner
# B: the site, on http://127.0.0.1:4173 (proxies /api, /sbx and /llm to the runner)
npm run dev
```

**Your sandbox survives runner restarts.** The runner restarts on every change under `runner/`. Without `SESSION_SECRET`, a local runner keeps the secret it signs sessions with in `course/.session-secret` (git-ignored), so a restart keeps you signed in and on the same sandbox. The database is `course/.data/quest.db` (git-ignored): delete it to start over with no users.

**Ask Temporal from a local runner** needs `GEMINI_API_KEY` (or any OpenAI-compatible model: `LLM_UPSTREAM_URL`, `HELPER_MODEL`). The first question asks you to verify with GitHub or Google, in a popup, once (Kapa's check that you're human); `KAPA_API_KEY` skips that. Each module's suggested questions are its `questions` (`quests/`).

Editing a module, the README, `starter/` or `authoring/` regenerates the content and reloads the page. `npm run content` regenerates it on its own; `npm run build` builds `web/dist`.

**The model from a local runner.** Sandboxes call the model through the runner's `/llm/v1`, which they can't reach on `localhost`. Put a tunnel in front of the runner and tell it: `npm run runner:tunnel` starts ngrok, runs the runner with `PUBLIC_URL` set to the tunnel, and stops ngrok when the runner exits (by hand: `ngrok http 8787`, then `PUBLIC_URL=https://<id>.ngrok-free.app npm run runner`). Restart the sandbox afterwards so its `.env` gets the URL. Without one, switch the sandbox to the scripted model (the sandbox menu in the top bar).

**The snapshot.** Sandboxes start from a Daytona snapshot named after a hash of its inputs (`pyproject.toml`, `uv.lock`, `scripts/setup_dogwood.sh`, `snapshot/Dockerfile`, `snapshot/lsp_bridge.py`). When any of them changes, build the new one: `npm run snapshot` (it compiles Dogwood, so a few minutes). `node snapshot/build.mjs --name` prints the name the runner will ask for; `--local` builds the image with local Docker instead.

## Writing for both modes

The modules in `quests/` ([quests/README.md](../quests/README.md)) are the source for GitHub and both modes of the site. Text that only applies in the browser goes inside an HTML comment, so GitHub never shows it:

```markdown
Restart the console: `uv run travel-stack restart console`, then reload the page<!-- browser
 (in the browser, click ↻ on the **Harness** tab)
-->.

<!-- browser
In the browser, your sandbox already did this when it started.
-->
```

A block on its own line is a paragraph; one that starts mid-line joins that line. Text for running locally only goes in `<!-- local -->…<!-- /local -->` (GitHub shows it).

The site also does a few things by itself, in the browser only:

- links to `http://localhost:8000` and `http://localhost:8233` open the console and Temporal UI panes, and so does "Temporal UI" (or "in the UI") in prose;
- `uv run hello-start XXX YYY` (a code block of just that, or inline) becomes a **trip button** in its place (the command isn't repeated beside it), like the worker toggle: it starts the trip in the commands terminal, then shows its workflow (running, completed…) with Open, which shows it in the Temporal UI pane. After one, "Open the link" becomes **Open its workflow**, which opens that trip's workflow;
- a link to `#sandbox` (`[Start my sandbox](#sandbox)`) is the sandbox's start button, showing its state (starting, ready);
- an archify diagram (`[![…](../../docs/architecture/x.png)](../../docs/architecture/x.html)`) in the briefing (the intro and the background before step 1) fills the workspace, as its **Diagram** view, in place of the code and the terminals; in the guide it becomes a small link to it. Exercise 1's intro shows the one in The pieces. A later background section with a diagram (exercise 2's The agent) shows its own; a step with one offers the Diagram tab without switching to it. A step brings Code back;
- a link to one of the assignment's sections, by its heading's anchor (`[Look inside](#5-look-inside-the-session)`, which GitHub follows too), moves the guide there; to the next section, it's **Done, next step**. A content test fails if the heading isn't there;
- a `<button class="pane-button" type="button" data-agent-tour>` (in a `<!-- browser` block) opens the Agent UI over the whole screen and starts its tour, the same tour as the **Tour** button in its tab bar (exercise 2 takes it when the agent's worker starts);
- a link to `#trip/SFO-JFK` (`[Open its workflow](#trip/SFO-JFK)`) opens that trip's latest workflow in the Temporal UI pane; locally it's just its words, so put it in a `<!-- browser` block;
- a `python` or `text` code block in an exercise whose editor has a `.py` or `.dw` file gets **← Insert into …**, which puts it in the editor and flashes the lines: in place of the exercise's TODO block when it's that block's solution (worked out from the `@@solution`/`@@starter` markers in `authoring/`), at the end of a policy when it's another rule, at the cursor otherwise. A block with no language (a diagram, sample output) gets none;
- every "stop the worker", "restart the worker", "start the worker again" and so on (not in headings) gets the **worker toggle** right after it: the worker's real state (from `pgrep` in the sandbox, so it's right however the worker was started) and a click to stop it (Ctrl-C) or start it, in the worker terminal. The dock has the same toggle;
- a command in prose (`` `uv run hello-start SEA LHR` ``: inline code starting `uv run`, `temporal`, `./quest` or `cat`, with no `<placeholder>`) gets a ▶ too;
- once a snippet is in its file, its button reads **✓ In … · Revert**: Revert puts the TODO block back (or removes an appended rule). The button follows the file, so it reads Insert again if you change the inserted lines. Snippets carry comments on the key concepts: write them that way, since they go into learners' files;
- a `bash` code block gets ▶, which types it into the `worker` terminal (for `uv run hello-worker` and `uv run travel-worker`, after a Ctrl-C) or the `commands` terminal. A worker command's ▶ (in a block or inline) is a toggle: **■ Stop** while the worker it starts is the one running, the same worker with the same settings (`FLAKY=1`, which the runner reads from the worker's environment). A block of just the plain worker command after a sentence that starts the worker is left out, since that sentence's toggle does the same;
- a file path in backticks opens the file, if the exercise's editor has it (its modules' `files`); a file's tab shows on the beats of the modules that list it (exercise 2 shows only `codemode/sandbox.py` until the agent comes in), and the file that's open always has one;
- the guide's **↺ Start over** asks, then deletes the sandbox and starts a new one (its first poll catches up the earlier exercises, so the exercise is as it starts), and takes the guide back to its first step; in Local mode it copies the exercise's `./quest reset` command;
- each exercise has a **code tour** (one of its modules' `tour`): its files a chunk at a time, each explained in a card over the editor, the chunk lit and the rest dimmed. The guide offers it at the end of the exercise's briefing, just before step 1 (**✦ Take the code tour** or **Skip the code tour**), or at the start of the module it belongs to, or after the beat its `tourAfter` names (exercise 2's comes after its "The agent" section), and the editor's **Code tour** button starts it again. Stops find their chunk by text (`from`, `to`), and the build fails if an anchor isn't in the starter, so a code change can't quietly break a tour;
- the first time (in whichever exercise the learner starts, normally exercise 1 from **Start**), the guide opens with two getting-started steps: setting up Ask Temporal, with only the guide on the page and a **Skip for now**, then the workspace, with **Show me around** for the page tour. Done once, they're remembered (`onboarded` in local storage; `?reset` clears it);
- each guide message types itself out the first time it's shown in a visit, like a streamed reply (`web/src/streaming.js`): prose a few characters at a time, code blocks, tables, images and buttons whole, at most about 2.5 s a message. A click finishes it, the replies wait for it, and a message gone back to is simply there. It streams with reduced motion too (only the caret stops blinking): it's text arriving, as in a chat;
- a **challenge** (`quests/…/challenge.md`) is a beat of its own, after its module (before that module's `## Check`): its choices as cards. With a sandbox, picking one puts its code into the file the way a snippet goes in (CodeEditor's `swapBlock`: in place of the block, a choice picked before, or an open TODO), and **Lock in and run it** types `./quest challenge FC1 A --run …` into the commands terminal; the card follows the same run's JSON lines (`GET /api/sandbox/challenge`), and once its workflow starts the Temporal UI pane opens on that workflow's Event History, filling in as it runs (at the end, the run's `focus` workflow, if that's another one). **Open its Event History** goes back to it. A wrong pick then comes back out of the file, quietly (at once, the editor being hidden), so the history stays on screen. Without a sandbox (or in Local mode) the choice's code shows in the card and its recording plays. A wrong pick is struck out with its outcome and explanation, two misses show the hint, and the right one earns 20, 10 or 2 XP (`web/src/challenge.js`) and shows every choice's run. Picks are saved with progress (`attempts`);
- the exercise's modules become the guide's conversation, one `##` section at a time: the intro, then each section in order. Numbered `## N. …` sections are steps ("Step 2 of 6", and ticked when the learner says Done), `## Check` gets a Run the check button, `## Stretch …` is offered as optional, and any other section is background. A section's own heading is replaced by the guide's, so keep titles short.

A check that passes leaves `.course/passed/<exercise>` and `.course/passed/<module>` (from `./quest check`), which is how the page knows to mark it passed.

To see the course as a new learner does, open it with `?reset` (`http://localhost:4173/?reset`). It deletes your sandbox, disconnects the docs, signs you out and clears everything the site keeps in your browser, then loads the home page.

To clear only the cookies, open it with `?purge` (`http://localhost:4173/?purge`). It signs you out and disconnects the docs, but keeps your sandbox, your progress and your persona, then loads the same page again.
