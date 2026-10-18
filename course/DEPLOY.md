# Deploying the course site

One [Fly.io](https://fly.io) app, `temporal-agent-governance-workshop`, runs the site and its runner in one Node process: the site and `/api` on port 443 (8080 inside), and the Temporal UI proxy on port 8081. Learners' sandboxes run on Daytona; Fly only proxies to them, so the machine stays small.

## What it needs

| Secret | What it's for |
|---|---|
| `DAYTONA_API_KEY` | creating, starting and deleting learners' sandboxes |
| `GEMINI_API_KEY` | the model, for the sandboxes' agents and for Ask Temporal. It stays on Fly: sandboxes get a key that only works on the runner's `/llm/v1` |
| `ACCESS_CODE` | the event's code, or several, comma-separated (`spring-sf,spring-nyc`): any one lets a learner in. Without it the browser runtime is off (reading still works). A runner listening on localhost needs none: it opens to that machine only |
| `SESSION_SECRET` | signs session cookies and the sandboxes' model keys. Changing it signs everyone out and breaks running sandboxes' model keys until they restart |
| `INSTRUCTOR_CODE` | `GET /api/admin/sandboxes` with header `x-instructor-code` |
| `KAPA_API_KEY` | optional. An API key for Temporal's Kapa project: Ask Temporal searches the docs with it for everyone, and nobody has to verify with GitHub or Google. Without it, each learner connects their own (free) Kapa sign-in once |

Settings in `fly.toml` (`[env]`): `PUBLIC_URL` (where sandboxes reach the model passthrough), `MAX_SANDBOXES` (40), `LLM_MODEL`. Others, with their defaults, are in `runner/config.mjs`: `SANDBOX_AUTO_STOP_MINUTES` (30), `SANDBOX_TTL_MINUTES` (1440), `LLM_RATE_PER_SANDBOX` (20 a minute), `LLM_RATE_GLOBAL` (300 a minute), `SANDBOX_SNAPSHOT` (to pin one).

Ask Temporal's, also in `runner/config.mjs`: `HELPER_MODEL` (defaults to `LLM_MODEL`), `HELPER_REASONING_EFFORT` (`low`; empty to leave it out), `HELPER_RATE_PER_LEARNER` (6 questions a minute), `HELPER_RATE_GLOBAL` (120 a minute), `KAPA_RATE_GLOBAL` (50 searches a minute: Kapa allows 60 a minute across all its users, and 600 a day per user), `KAPA_MCP_URL` (`https://temporal.mcp.kapa.ai/`). The helper needs `GEMINI_API_KEY` and a session (the access code), not Daytona, so learners working locally can use it too.

## First deploy

```bash
# 1. The sandbox snapshot, once per dependency change (compiles Dogwood: a few minutes).
#    After the first deploy, CI builds it and deploys on every merge to main
#    (.github/workflows/deploy.yml; repository secrets FLY_API_TOKEN and DAYTONA_API_KEY).
cd course && npm install && npm run snapshot

# 2. The app and its secrets
fly apps create temporal-agent-governance-workshop
fly secrets set --app temporal-agent-governance-workshop \
  DAYTONA_API_KEY=... GEMINI_API_KEY=... \
  ACCESS_CODE=... INSTRUCTOR_CODE=... SESSION_SECRET="$(openssl rand -hex 32)"

# 3. Deploy, from course/ (it builds from the repo root)
npm run deploy
```

`npm run deploy` is `fly deploy . --config course/fly.toml --dockerfile course/Dockerfile --ignorefile course/.dockerignore --ha=false`, run from the repo root. Keep it to **one machine** (`--ha=false`; `fly scale count 1` if a second appears): the runner keeps each sandbox's terminal connections and the rate limits in memory. Nothing that matters is lost on a restart, because sandboxes are found again by their Daytona labels, but two machines would each hold half the terminals.

Then open `https://temporal-agent-governance-workshop.fly.dev`, enter the code, and start a sandbox. `GET /api/health` reports whether the runtime is on.

## The e2e tests and their email

Playwright tests of the live site ([e2e/README.md](e2e/README.md)) run every day at 14:00 UTC and after every deploy, and email the result through [Resend](https://resend.com): every day whatever it is, after a deploy only a failure. Set them up once, from the repo root:

```bash
# 1. A code of the tests' own, kept in the app's list beside the event's codes
E2E_CODE="e2e-$(openssl rand -hex 6)"
fly secrets set --app temporal-agent-governance-workshop ACCESS_CODE="<the event's codes>,$E2E_CODE"
gh secret set E2E_ACCESS_CODE --body "$E2E_CODE"
gh secret set E2E_INSTRUCTOR_CODE        # optional: the app's INSTRUCTOR_CODE, for the admin test

# 2. The email: a Resend API key (resend.com/api-keys, "Sending access"), pasted at the prompt
gh secret set RESEND_API_KEY
gh variable set E2E_MAIL_FROM --body "onboarding@resend.dev"
gh variable set E2E_MAIL_TO --body "taoguo1@gmail.com"

# 3. A first run, to see the email arrive (Actions → E2E shows it too)
gh workflow run e2e.yml -f tier=all -f email=always
```

- **Who can get it.** Resend's test sender, `onboarding@resend.dev`, only delivers to the address the Resend account signed up with. To send to others (comma-separated in `E2E_MAIL_TO`), verify a domain in Resend and set `E2E_MAIL_FROM` to an address on it.
- **Without a key** the runs still happen and say there's no email; without `E2E_ACCESS_CODE`, only the tiers that need no code run.
- **What a run tests** after a deploy: every tier, a real sandbox included, when the exercises, the sandbox's files or the runner changed; the quick tiers otherwise (`deploy.yml`, job `e2e-scope`). A failure turns the Deploy run red but doesn't roll back.
- **To run them by hand**: `gh workflow run e2e.yml -f tier=public` (or `auth`, `all`), or locally: `cd course/e2e && npm ci && npx playwright install chromium && E2E_ACCESS_CODE=... npm test`.

## Before an event

- **Daytona quota.** 40 sandboxes × 2 vCPU × 4 GB is 80 vCPU and 160 GB at peak. Check the org's limits (the GPU endpoint, if it's up, shares them), and lower `MAX_SANDBOXES` in `fly.toml` if needed (then deploy).
- **Gemini spend.** Set a budget cap on the Google project that owns `GEMINI_API_KEY`, and check it has credit (an empty prepaid balance answers 402, and both the agents and Ask Temporal stop). The runner's rate limits slow a runaway loop; the cap stops it.
- **Ask Temporal.** Open the site, press ⌘K, connect the docs (or set `KAPA_API_KEY`), and ask one question: it should search, cite and link. With a room of learners on their own Kapa sign-ins, the 60-a-minute team limit is the one to watch; a busy search says so in the answer instead of failing it.
- **A fresh code.** `fly secrets set ACCESS_CODE=...` per event. Learners already signed in stay signed in, even when their code is no longer in the list. For overlapping cohorts, list several (`ACCESS_CODE=cohort-a,cohort-b`) and drop one when its cohort ends. Codes can't contain commas. **Keep the e2e tests' code in the list** (`ACCESS_CODE=cohort-a,<the E2E_ACCESS_CODE repository secret>`), or their signed-in tiers fail from the next run on.
- **Quiet the tests during the event.** The daily E2E run starts a sandbox of its own. Set the repository variable `E2E_SKIP_SANDBOX=1` for the event's days, and delete it afterwards: the quick tiers keep running.
- **The snapshot is current.** `node course/snapshot/build.mjs --name` should name a snapshot that exists. The **Deploy** workflow builds it before each deploy from `main` (with the repository secret `DAYTONA_API_KEY`); `npm run snapshot` says whether it exists, or builds it. A deploy whose snapshot is missing fails at "Creating your sandbox" with that name in the error.
- **Warm it.** `min_machines_running = 0` lets Fly stop the machine when nobody's using it; the first visitor waits a few seconds for it to start. For the event, `fly scale count 1` and set `min_machines_running = 1`.
- **Who's in.** `curl -H "x-instructor-code: $INSTRUCTOR_CODE" https://temporal-agent-governance-workshop.fly.dev/api/admin/sandboxes` lists sandboxes, their state and the exercise each learner last had open.

## After

Sandboxes stop after 30 idle minutes and are deleted 24 hours after they were created. To delete them all at once: Daytona's dashboard, filtered by label `app=governance-course`.
