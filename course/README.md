# The browser course

A website for the workshop: every exercise's instructions, and, for people with the event's access code, their own cloud sandbox to do it in. It's the same workshop as the rest of this repo; the site is generated from it.

- **Reading** is open to anyone: the instructions, the setup guide, the TODO files, the solutions.
- **The browser runtime** gives each learner a [Daytona](https://www.daytona.io/) sandbox with everything installed and `travel-stack up` already run, and puts it in the page, laid out like the [loan-origination course](https://temporal-training-agentic-loan-origination.fly.dev): a workspace on the left (tabs for the exercise's code, the agent's console and the Temporal UI, one at a time at full width, over a dock with two real terminals side by side, `worker` and `commands`) and the guide on the right, which brings the right tab forward for each step.
- **Local** stays first-class: the setup page covers running it on your machine, and exercise pages show the local instructions when the browser runtime isn't available. (There was a Browser | Local switch; the guide's header has **↺ Start over** instead.)
- **The instructions are a guide**: a conversation that shows one step at a time. You say **Done, next step**, go **← Back**, or ask about the step you're on, and Ask Temporal answers right under it.
- **Ask Temporal** (⌘K / Ctrl+K, or the button in the top bar) answers questions about Temporal from Temporal's docs, through [Kapa's MCP server](https://temporal.mcp.kapa.ai), with links to the pages it used. It knows the exercise you're on, can see the file you have open, and takes a selection from the instructions, the editor or a terminal (select a traceback, click **✦ Ask**). It needs the access code, not a sandbox, so it works in Local mode too.

Hosting it: [DEPLOY.md](DEPLOY.md). Why it's built this way: [DESIGN.md](DESIGN.md).

## What's where

```
course/
  content/      build.mjs: the assignments, README and starter/solution files → web/src/generated/course-data.json
                exercises.mjs: each exercise's editor files and worker command
  web/          the Vue site (Vite): pages/, components/, store.js, styles.css
  runner/       the Node service: the /api, the sandboxes, the terminals, the proxies, the model passthrough,
                and Ask Temporal (helper.mjs; kapa.mjs and mcp.mjs talk to the docs)
  snapshot/     the sandbox image (Dockerfile), lsp_bridge.py (the editor's language server), and
                build.mjs, which builds it as a Daytona snapshot
  tests/        node --test: the content build, auth, rate limits, the passthrough
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
# No access code needed: on localhost it opens to this machine only.
DAYTONA_API_KEY=... GEMINI_API_KEY=... npm run runner
# B: the site, on http://127.0.0.1:4173 (proxies /api, /sbx and /llm to the runner)
npm run dev
```

**Your sandbox survives runner restarts.** The runner restarts on every change under `runner/`. Without `SESSION_SECRET`, a local runner keeps the secret it signs sessions with in `course/.session-secret` (git-ignored), so a restart keeps you signed in and on the same sandbox. Delete the file to start over as a new learner.

**Ask Temporal from a local runner** needs `GEMINI_API_KEY` (or any OpenAI-compatible model: `LLM_UPSTREAM_URL`, `HELPER_MODEL`). The first question asks you to verify with GitHub or Google, in a popup, once (Kapa's check that you're human); `KAPA_API_KEY` skips that. Each exercise's suggested questions are in `content/exercises.mjs`.

Editing an assignment, the README, `starter/` or `solutions/` regenerates the content and reloads the page. `npm run content` regenerates it on its own; `npm run build` builds `web/dist`.

**The model from a local runner.** Sandboxes call the model through the runner's `/llm/v1`, which they can't reach on `localhost`. Put a tunnel in front of the runner and tell it: `npm run runner:tunnel` starts ngrok, runs the runner with `PUBLIC_URL` set to the tunnel, and stops ngrok when the runner exits (by hand: `ngrok http 8787`, then `PUBLIC_URL=https://<id>.ngrok-free.app npm run runner`). Restart the sandbox afterwards so its `.env` gets the URL. Without one, switch the sandbox to the scripted model (the sandbox menu in the top bar).

**The snapshot.** Sandboxes start from a Daytona snapshot named after a hash of its inputs (`pyproject.toml`, `uv.lock`, `scripts/setup_dogwood.sh`, `snapshot/Dockerfile`, `snapshot/lsp_bridge.py`). When any of them changes, build the new one: `npm run snapshot` (it compiles Dogwood, so a few minutes). `node snapshot/build.mjs --name` prints the name the runner will ask for; `--local` builds the image with local Docker instead.

## Writing for both modes

The assignments in `challenges/*/assignment.md` are the source for GitHub, Instruqt and both modes of the site. Text that only applies in the browser goes inside an HTML comment, so GitHub and Instruqt never show it:

```markdown
Restart the console: `uv run travel-stack restart console`, then reload the page<!-- browser
 (in the browser, click ↻ on the **Harness** tab)
-->.

<!-- browser
In the browser, your sandbox already did this when it started.
-->
```

A block on its own line is a paragraph; one that starts mid-line joins that line. Text for running locally only goes in `<!-- local -->…<!-- /local -->` (GitHub and Instruqt show it).

The site also does a few things by itself, in the browser only:

- links to `http://localhost:8000` and `http://localhost:8233` open the console and Temporal UI panes, and so does "Temporal UI" (or "in the UI") in prose;
- `uv run hello-start XXX YYY` (a code block of just that, or inline) becomes a **trip button** in its place (the command isn't repeated beside it), like the worker toggle: it starts the trip in the commands terminal, then shows its workflow (running, completed…) with Open, which shows it in the Temporal UI pane. After one, "Open the link" becomes **Open its workflow**, which opens that trip's workflow;
- a link to `#sandbox` (`[Start my sandbox](#sandbox)`) is the sandbox's start button, showing its state (starting, ready);
- a link to `#trip/SFO-JFK` (`[Open its workflow](#trip/SFO-JFK)`) opens that trip's latest workflow in the Temporal UI pane; locally it's just its words, so put it in a `<!-- browser` block;
- a `python` or `text` code block in an exercise whose editor has a `.py` or `.dw` file gets **← Insert into …**, which puts it in the editor and flashes the lines: in place of the exercise's TODO block when it's that block's solution (worked out from the `@@solution`/`@@starter` markers in `authoring/`), at the end of a policy when it's another rule, at the cursor otherwise. A block with no language (a diagram, sample output) gets none;
- every "stop the worker", "restart the worker", "start the worker again" and so on (not in headings) gets the **worker toggle** right after it: the worker's real state (from `pgrep` in the sandbox, so it's right however the worker was started) and a click to stop it (Ctrl-C) or start it, in the worker terminal. The dock has the same toggle;
- a command in prose (`` `uv run hello-start SEA LHR` ``: inline code starting `uv run`, `temporal`, `./challenges/` or `cat`, with no `<placeholder>`) gets a ▶ too;
- once a snippet is in its file, its button reads **✓ In … · Revert**: Revert puts the TODO block back (or removes an appended rule). The button follows the file, so it reads Insert again if you change the inserted lines. Snippets carry comments on the key concepts: write them that way, since they go into learners' files;
- a `bash` code block gets ▶, which types it into the `worker` terminal (for `uv run hello-worker` and `uv run travel-worker`, after a Ctrl-C) or the `commands` terminal. A worker command's ▶ (in a block or inline) is a toggle: **■ Stop** while the worker it starts is the one running, the same worker with the same settings (`FLAKY=1`, which the runner reads from the worker's environment). A block of just the plain worker command after a sentence that starts the worker is left out, since that sentence's toggle does the same;
- a file path in backticks opens the file, if the exercise's editor has it (`content/exercises.mjs`);
- the guide's **↺ Start over** runs the exercise's `reset.sh` (in the worker terminal, restarting a running worker on the restored code) and takes the guide back to its first step; in Local mode it copies the command;
- each exercise has a **code tour** (`tour` in `content/exercises.mjs`): its files a chunk at a time, each explained in a card over the editor, the chunk lit and the rest dimmed. The guide offers it at the end of the exercise's briefing, just before step 1 (**✦ Take the code tour** or **Skip the code tour**), and the editor's **Code tour** button starts it again. Stops find their chunk by text (`from`, `to`), and the build fails if an anchor isn't in the starter, so a code change can't quietly break a tour;
- the first time (in whichever exercise the learner starts, normally exercise 1 from **Start**), the guide opens with two getting-started steps: setting up Ask Temporal, with only the guide on the page and a **Skip for now**, then the workspace, with **Show me around** for the page tour. Done once, they're remembered (`onboarded` in local storage; `?reset` clears it);
- each guide message types itself out the first time it's shown in a visit, like a streamed reply (`web/src/streaming.js`): prose a few characters at a time, code blocks, tables, images and buttons whole, at most about 2.5 s a message. A click finishes it, the replies wait for it, and a message gone back to is simply there. It streams with reduced motion too (only the caret stops blinking): it's text arriving, as in a chat;
- the assignment becomes the guide's conversation, one `##` section at a time: the intro, then each section in order. Numbered `## N. …` sections are steps ("Step 2 of 6", and ticked when the learner says Done), `## Check` gets a Run the check button, `## Stretch …` is offered as optional, and any other section is background. A section's own heading is replaced by the guide's, so keep titles short.

A check that passes leaves `.course/passed/<exercise>` (from `challenges/lib.sh`), which is how the page knows to mark it passed.

To see the course as a new learner does, open it with `?reset` (`http://localhost:4173/?reset`). It deletes your sandbox, disconnects the docs, signs you out and clears everything the site keeps in your browser, then loads the home page.
