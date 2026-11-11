# Deploying the course site

One [Fly.io](https://fly.io) app, `temporal-quest`, runs the site and its runner in one Node process: the site and `/api` on port 443 (8080 inside), and the Temporal UI proxy on port 8081. Learners' sandboxes run on Daytona; Fly only proxies to them, so the machine stays small. Users, the allowlist and the activity log are in SQLite on a Fly volume (`quest_data`, mounted at `/data`).

## What it needs

| Secret | What it's for |
|---|---|
| `DAYTONA_API_KEY` | creating, starting and deleting learners' sandboxes |
| `GEMINI_API_KEY` | the model, for the sandboxes' agents and for Ask Temporal. It stays on Fly: sandboxes get a key that only works on the runner's `/llm/v1` |
| `RESEND_API_KEY` | sends the sign-in codes and the access requests' emails ([Resend](https://resend.com), "Sending access"), from a verified `temporalquest.dev` (below). Without it nobody can sign in, but the e2e tests. A runner listening on localhost needs none: it prints the codes and lets any email in, from that machine only |
| `FEEDBACK_EMAILS` | who gets the feedback learners send (comma-separated; default `tao.guo@temporal.io`, empty for nobody). It's kept either way, under `/admin` → Feedback. Needs `RESEND_API_KEY` |
| `ADMIN_EMAILS` | the admins, comma-separated (`ana@temporal.io,bo@temporal.io`): `/admin`, and the emails about access requests. Always allowed in. Put the e2e tests' admin here too (`e2e+admin@temporalquest.dev`) |
| `SESSION_SECRET` | signs session cookies (14 days from sign-in) and the sandboxes' model keys. Changing it signs everyone out and breaks running sandboxes' model keys until they restart |
| `E2E_SIGNIN_KEY` | the e2e tests' sign-in: their addresses (`e2e+…@temporalquest.dev`) get no email, and sign in with a code derived from this key. The same value as the repository secret of that name |
| `KAPA_API_KEY` | optional. An API key for Temporal's Kapa project: Ask Temporal searches the docs with it for everyone, and nobody has to verify with GitHub or Google. Without it, each learner connects their own (free) Kapa sign-in once |

Settings in `fly.toml` (`[env]`): `PUBLIC_URL` (where sandboxes reach the model passthrough), `MAX_SANDBOXES` (40), `LLM_MODEL`, `DATABASE_PATH` (`/data/quest.db`, on the volume). `MAIL_FROM` (`Temporal Quest <signin@temporalquest.dev>`) is the sender. Others, with their defaults, are in `runner/config.mjs`: `SANDBOX_AUTO_STOP_MINUTES` (30), `SANDBOX_TTL_MINUTES` (1440), `LLM_RATE_PER_SANDBOX` (20 a minute), `LLM_RATE_GLOBAL` (300 a minute), `SANDBOX_SNAPSHOT` (to pin one).

Ask Temporal's, also in `runner/config.mjs`: `HELPER_MODEL` (defaults to `LLM_MODEL`), `HELPER_REASONING_EFFORT` (`low`; empty to leave it out), `HELPER_RATE_PER_LEARNER` (6 questions a minute), `HELPER_RATE_GLOBAL` (120 a minute), `KAPA_RATE_GLOBAL` (50 searches a minute: Kapa allows 60 a minute across all its users, and 600 a day per user), `KAPA_MCP_URL` (`https://temporal.mcp.kapa.ai/`). The helper needs `GEMINI_API_KEY` and a session, not Daytona, so learners working locally can use it too.

## First deploy

```bash
# 1. The sandbox snapshot, once per dependency change (compiles Dogwood: a few minutes).
#    After the first deploy, CI builds it and deploys on every merge to main
#    (.github/workflows/deploy.yml; repository secrets FLY_API_TOKEN and DAYTONA_API_KEY).
cd course && npm install && npm run snapshot

# 2. The app, its volume and its secrets
fly apps create temporal-quest
fly volumes create quest_data --app temporal-quest --region sjc --size 1
fly secrets set --app temporal-quest \
  DAYTONA_API_KEY=... GEMINI_API_KEY=... RESEND_API_KEY=... \
  ADMIN_EMAILS=you@temporal.io,e2e+admin@temporalquest.dev \
  E2E_SIGNIN_KEY="$(openssl rand -hex 24)" SESSION_SECRET="$(openssl rand -hex 32)"

# 3. Deploy, from course/ (it builds from the repo root)
npm run deploy
```

**The sender.** In Resend, add the domain `temporalquest.dev` and put the DNS records it lists (SPF, DKIM) where the domain's DNS is. Until it's verified, Resend refuses to send from it, and nobody gets a code.

**The volume** is one 1 GB disk in `sjc`, which keeps the machine there. Fly snapshots it daily and keeps the snapshots for 5 days (`fly volumes snapshots list quest_data`); restore one with `fly volumes create quest_data --snapshot-id …`.

`npm run deploy` is `fly deploy . --config course/fly.toml --dockerfile course/Dockerfile --ignorefile course/.dockerignore --ha=false`, run from the repo root. Keep it to **one machine** (`--ha=false`; `fly scale count 1` if a second appears): the runner keeps each sandbox's terminal connections and the rate limits in memory. Nothing that matters is lost on a restart, because sandboxes are found again by their Daytona labels, but two machines would each hold half the terminals.

Then open `https://temporalquest.dev/#/admin`, sign in with your email (one of `ADMIN_EMAILS`), and add a cohort and its learners. `GET /api/health` reports whether the runtime is on.

## Who may sign in

- **Learners sign in with their work email** and a 6-digit code sent to it (10 minutes, one use). The session lasts 14 days. The first time, they give their name and role.
- **The allowlist** (`/admin` → Cohorts & allowlist) says who's in: exact emails, or domain rules (`@acme.com`), each in a **cohort**. A cohort has an optional path (its learners' route on the map), an optional end date (after it, they can't sign in) and a daily sandbox allowance (8 hours in any 24 unless set). Paste an event's registrations into its cohort, one per line.
- **Everyone else with a company email** can ask: they sign in with a code, then file a request with their name and role. The admins get an email; **Requests** approves the one email or the whole domain (into the built-in **On-demand** cohort), or rejects it, and the learner is emailed. Personal addresses (Gmail and the like) are asked for a company one, unless the allowlist has them exactly.
- **Block** a learner (Learners → their row) to sign them out at once; **Delete** removes them, their activity and their sandbox.

## The e2e tests and their email

Playwright tests of the live site ([e2e/README.md](e2e/README.md)) run every day at 14:00 UTC and after every deploy, and email the result through [Resend](https://resend.com): every day whatever it is, after a deploy only a failure. Set them up once, from the repo root:

```bash
# 1. The tests' sign-in: the app's E2E_SIGNIN_KEY, and its admin in the app's ADMIN_EMAILS
gh secret set E2E_SIGNIN_KEY             # the same value as the app's
gh variable set E2E_ADMIN_EMAIL --body "e2e+admin@temporalquest.dev"   # optional: this is the default

# 2. The email: a Resend API key (resend.com/api-keys, "Sending access"), pasted at the prompt
gh secret set RESEND_API_KEY
gh variable set E2E_MAIL_FROM --body "onboarding@resend.dev"
gh variable set E2E_MAIL_TO --body "taoguo1@gmail.com"

# 3. A first run, to see the email arrive (Actions → E2E shows it too)
gh workflow run e2e.yml -f tier=all -f email=always
```

- **Who can get it.** Resend's test sender, `onboarding@resend.dev`, only delivers to the address the Resend account signed up with. To send to others (comma-separated in `E2E_MAIL_TO`), verify a domain in Resend and set `E2E_MAIL_FROM` to an address on it.
- **Without a key** the runs still happen and say there's no email; without `E2E_SIGNIN_KEY`, only the tier that needs no sign-in runs. Each signed-in test signs in a new learner of its own (`e2e+…@temporalquest.dev`), which the tests' admin puts on the allowlist in an `E2E` cohort and deletes after.
- **After a deploy**, E2E runs as a workflow of its own, started by the Deploy run's success, so it never holds up the next deploy. It tests every tier, a real sandbox included, when the exercises, the sandbox's files, the runner or the site changed since the deploy before; the quick tiers otherwise (`e2e.yml`, job `scope`). A failure turns the E2E run red and emails, but doesn't roll back. It doesn't email when a newer deploy started during the run, since that deploy's restart may be what failed it, and that deploy gets an E2E run of its own.
- **To run them by hand**: `gh workflow run e2e.yml -f tier=public` (or `auth`, `all`), or locally: `cd course/e2e && npm ci && npx playwright install chromium && E2E_SIGNIN_KEY=... npm test`.

## Before an event

- **Daytona quota.** 40 sandboxes × 2 vCPU × 4 GB is 80 vCPU and 160 GB at peak. Check the org's limits (the GPU endpoint, if it's up, shares them), and lower `MAX_SANDBOXES` in `fly.toml` if needed (then deploy).
- **Gemini spend.** Set a budget cap on the Google project that owns `GEMINI_API_KEY`, and check it has credit (an empty prepaid balance answers 402, and both the agents and Ask Temporal stop). The runner's rate limits slow a runaway loop; the cap stops it.
- **Ask Temporal.** Open the site, press ⌘K, connect the docs (or set `KAPA_API_KEY`), and ask one question: it should search, cite and link. With a room of learners on their own Kapa sign-ins, the 60-a-minute team limit is the one to watch; a busy search says so in the answer instead of failing it.
- **A cohort.** In `/admin`, a cohort for the event: its path, an end date a day or two after, and its learners' emails (or their company's domain). Anyone not on the list can still ask, from the sign-in.
- **Quiet the tests during the event.** The daily E2E run starts a sandbox of its own. Set the repository variable `E2E_SKIP_SANDBOX=1` for the event's days, and delete it afterwards: the quick tiers keep running.
- **The snapshot is current.** `node course/snapshot/build.mjs --name` should name a snapshot that exists. The **Deploy** workflow builds it before each deploy from `main` (with the repository secret `DAYTONA_API_KEY`); `npm run snapshot` says whether it exists, or builds it. A deploy whose snapshot is missing fails at "Creating your sandbox" with that name in the error.
- **Warm it.** `min_machines_running = 0` lets Fly stop the machine when nobody's using it; the first visitor waits a few seconds for it to start. For the event, `fly scale count 1` and set `min_machines_running = 1`.
- **Who's in.** `/admin` → Learners, filtered by the cohort: each learner's current module and minutes on it (anyone on one module for more than 10 minutes is highlighted), modules passed, XP and sandbox time. A learner's row opens their journey. Sandboxes lists the sandboxes and their state.

## After

Sandboxes stop after 30 idle minutes and are deleted 24 hours after they were created. To delete them all at once: Daytona's dashboard, filtered by label `app=governance-course`.
