# Deploying the course site to Fly.io

The runbook for hosting the browser course (`course/`) for an event: first deploy, the checklist before each session, what to watch during it, and cleanup. For every setting and why the site is built this way, see [course/DEPLOY.md](../course/DEPLOY.md) and [course/DESIGN.md](../course/DESIGN.md).

## What runs where

```
learner's browser ──▶ Fly app: temporal-quest  (one machine, one Node process)
                        :443  the site, /api, the model passthrough (/llm/v1)
                        :8081 the Temporal UI proxy
                              │
                              ├──▶ Daytona: one sandbox per learner (1 vCPU / 2 GB, from a snapshot)
                              └──▶ Gemini: the agents' model and Ask Temporal
```

Fly only serves the site and proxies, so the machine stays small (shared, 2 vCPU, 1 GB). The heavy lifting is on Daytona. Sandboxes reach the model through the runner's `/llm/v1` with a per-sandbox key, so the real `GEMINI_API_KEY` never leaves Fly.

## Prerequisites

- **flyctl**, logged in: `brew install flyctl && fly auth login`. You need access to the Fly org that owns the app.
- **Node 22** and `npm`, to build the snapshot and run the tests.
- **A Daytona API key** for an org with enough quota (see [Before an event](#before-an-event)).
- **A Gemini API key** on a Google project with credit and a budget cap.
- Optional: **a Kapa API key** for Temporal's Kapa project. Without it, each learner signs in to Kapa once for Ask Temporal.

## First deploy

All commands run from `course/` unless noted.

### 1. Build the sandbox snapshot

Learners' sandboxes start from a Daytona snapshot named after a hash of its inputs (`pyproject.toml`, `uv.lock`, `scripts/setup_dogwood.sh`, `course/snapshot/*`). It needs rebuilding whenever any of those change.

**CI builds it for you.** Every deploy from CI (see [Automatic deploys](#automatic-deploys)) first runs [.github/workflows/sandbox-snapshot.yml](../.github/workflows/sandbox-snapshot.yml), which builds the snapshot when its inputs changed and otherwise takes a few seconds. It needs the repository secret `DAYTONA_API_KEY` (Settings → Secrets and variables → Actions). To build or force a rebuild by hand: Actions → **Sandbox snapshot** → **Run workflow**.

To build it from your machine instead (the first time, or without CI):

```bash
npm install
DAYTONA_API_KEY=... npm run snapshot     # compiles Dogwood: several minutes
node snapshot/build.mjs --name           # the name the runner will ask for
```

If the snapshot already exists, `npm run snapshot` says so and does nothing (`--force` rebuilds it).

### 2. Create the app and set its secrets

Export the values first (or keep them in your shell profile or a password manager's CLI), then set them all at once. Each `${VAR:?}` stops the command with a message if that variable is empty, so nothing is half-set:

```bash
fly apps create temporal-quest
# The database (users, the allowlist, the activity log): one 1 GB volume, in the app's region
fly volumes create quest_data --app temporal-quest --region sjc --size 1

export DAYTONA_API_KEY=... GEMINI_API_KEY=... RESEND_API_KEY=... ADMIN_EMAILS=you@temporal.io,e2e+admin@temporalquest.dev

fly secrets set --app temporal-quest \
  DAYTONA_API_KEY="${DAYTONA_API_KEY:?set DAYTONA_API_KEY}" \
  GEMINI_API_KEY="${GEMINI_API_KEY:?set GEMINI_API_KEY}" \
  RESEND_API_KEY="${RESEND_API_KEY:?set RESEND_API_KEY}" \
  ADMIN_EMAILS="${ADMIN_EMAILS:?set ADMIN_EMAILS}" \
  E2E_SIGNIN_KEY="${E2E_SIGNIN_KEY:-$(openssl rand -hex 24)}" \
  SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}" \
  ${KAPA_API_KEY:+KAPA_API_KEY="$KAPA_API_KEY"}
```

`SESSION_SECRET` and `E2E_SIGNIN_KEY` are generated when you haven't exported them, which is right for the first deploy only (copy `E2E_SIGNIN_KEY` into the repository secret of that name: [course/DEPLOY.md](../course/DEPLOY.md#the-e2e-tests-and-their-email)). To change other secrets later, set just those (`fly secrets set ... ADMIN_EMAILS="$ADMIN_EMAILS"`). Re-running the whole command without `SESSION_SECRET` exported makes a new one, which signs everyone out. `KAPA_API_KEY` is included only when it's set.

| Secret | What happens without it |
|---|---|
| `DAYTONA_API_KEY` | no sandboxes; the site is read-only |
| `GEMINI_API_KEY` | no model for the agents, no Ask Temporal |
| `RESEND_API_KEY` | nobody can sign in (no code can be sent), so only the map is open. Its sender, `temporalquest.dev`, must be verified in Resend (DNS records) |
| `ADMIN_EMAILS` | nobody can use `/admin`, so nobody can be added to the allowlist |
| `SESSION_SECRET` | a random one per restart, so every restart signs everyone out. Set it once and leave it: changing it signs everyone out and breaks running sandboxes' model keys until they restart |
| `E2E_SIGNIN_KEY` | the e2e tests can't sign in, and their signed-in tiers skip |
| `KAPA_API_KEY` | learners connect their own Kapa sign-in |

Non-secret settings (`PUBLIC_URL`, `MAX_SANDBOXES`, `LLM_MODEL`, region) are in [course/fly.toml](../course/fly.toml) under `[env]`. If you deploy under a different app name, change `app` and `PUBLIC_URL` there too.

### 3. Deploy

```bash
npm run deploy
```

This runs, from the repo root:

```bash
fly deploy . --config course/fly.toml --dockerfile course/Dockerfile \
  --ignorefile course/.dockerignore --ha=false
```

The repo root is the build context because the runner uploads the workshop's own files into each sandbox. The image build runs `npm test`, so a failing test fails the deploy.

Keep it to **one machine**: `--ha=false` does that, and `fly scale count 1 --app temporal-quest` fixes it if a second appears. The runner holds terminal connections and rate limits in memory; two machines would each hold half of them.

### 4. Smoke test

```bash
curl https://temporalquest.dev/api/health
# {"ok":true,"runtime":{"enabled":true},...}
```

`runtime.enabled: false` means a missing `DAYTONA_API_KEY` or `RESEND_API_KEY`. Then open `https://temporalquest.dev/#/admin`, sign in with your email (a code arrives by email), and put yourself in a cohort. Open exercise 1, start a sandbox, and run the worker. Press ⌘K and ask Ask Temporal one question: it should search the docs, cite and link.

## Automatic deploys

After the first deploy, every merge to `main` deploys itself: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) builds the sandbox snapshot if needed, deploys to Fly, then checks `/api/health`. Changes only under `instructor/` don't deploy. To deploy by hand from GitHub: Actions → **Deploy** → **Run workflow**.

It needs two repository secrets (Settings → Secrets and variables → Actions):

```bash
# A deploy token scoped to this app
fly tokens create deploy --app temporal-quest
gh secret set FLY_API_TOKEN      # paste the token
gh secret set DAYTONA_API_KEY    # for the snapshot build
```

The app's own secrets (`GEMINI_API_KEY`, `RESEND_API_KEY`, ...) stay in Fly; CI never sees them.

**A deploy restarts the runner.** Learners keep their sandboxes and stay signed in, but their terminals reconnect. Don't merge to `main` during a session. If you need to block deploys for the day, disable the workflow: `gh workflow disable deploy.yml` (and `gh workflow enable deploy.yml` after).

## Before an event

**A week before**

- **Daytona quota.** 40 sandboxes × 1 vCPU × 2 GB is 40 vCPU and 80 GB at peak. Check the org's limits; the shared GPU endpoint, if you run it, uses the same quota. Lower `MAX_SANDBOXES` in `fly.toml` (and deploy) to fit the room.
- **Gemini budget.** Set a cap on the Google project and check its balance. An empty prepaid balance answers 402, which stops both the agents and Ask Temporal. The runner's rate limits (20 calls a minute per sandbox, 300 overall) slow a runaway loop; only the cap stops it.

**The day before**

- **Make sure the version you'll teach is deployed:** the latest **Deploy** run on `main` passed (or run `npm run deploy`, after `npm run snapshot` if dependencies changed). Freeze `main` or disable the workflow until after the session. A deploy whose snapshot doesn't exist fails at "Creating your sandbox", with the snapshot name in the error.
- **A cohort for the event.** In `/admin` → **Cohorts & allowlist**, **New cohort**: its name (`SF Nov 2026`), the event's path, an end date a day or two after (after it, its learners can't sign in), and the sandbox time per learner (8 hours unless you change it). Then paste the registrations' emails into it, one per line, or the company's domain (`@acme.com`) for everyone there. People who aren't on it can still ask from the sign-in; their requests are in **Requests**, and the admins get an email for each.

  Running more than one session at once (two rooms, or a morning and an afternoon cohort)? A cohort each, so you can follow each room on its own.
- **Run the smoke test** above end to end, including one exercise check.

**On the day, about 30 minutes before**

- **Keep the machine warm.** By default Fly stops the machine when idle (`min_machines_running = 0`), and the first visitor waits a few seconds. For the event, set `min_machines_running = 1` in `course/fly.toml` under `[http_service]` and merge it to `main`, which deploys it (do this before you freeze `main`). Set it back to `0` afterwards. A local `npm run deploy` of an uncommitted change works too, but the next CI deploy undoes it.
- **Check who's in** as learners arrive: `/admin` → **Learners**, filtered by the event's cohort. Each learner's current module and minutes on it, modules passed and XP; anyone on one module for more than 10 minutes is highlighted at the top. A row opens the learner's journey. **Sandboxes** lists each sandbox and its state, against `max`.

## During the event

| Need | Command |
|---|---|
| Live logs | `fly logs --app temporal-quest` |
| Machine state | `fly status --app temporal-quest` |
| Restart the runner | `fly apps restart temporal-quest` |
| Shell on the machine | `fly ssh console --app temporal-quest` |
| Roll back | `fly releases --app temporal-quest --image`, then from the repo root `fly deploy --config course/fly.toml --image <image-ref>` |

**When something breaks**

- **"Creating your sandbox" fails with a snapshot name:** the snapshot for this deploy doesn't exist. Run the **Sandbox snapshot** workflow (or `npm run snapshot`); no redeploy is needed. CI deploys build it first, so this only happens after a manual `npm run deploy`.
- **Sandboxes fail to start for everyone:** the Daytona quota or `MAX_SANDBOXES` is full. Check `/admin` → Sandboxes and Daytona's dashboard.
- **A learner can't start a sandbox, "out of sandbox time":** they've used their cohort's daily allowance (8 hours in any 24 by default). Raise it on their cohort in `/admin`, and they can start one at once.
- **A learner gets no code:** check the spam folder, then Resend's dashboard (Emails) for the address. They can ask for a new one; three an address every 15 minutes.
- **The agent stops answering (402s or 429s in the logs):** Gemini credit or quota. Learners can switch their sandbox to the scripted model from the sandbox menu in the top bar; it plays every walkthrough, including the injection.
- **Ask Temporal says the search is busy:** the Kapa team limit (60 a minute). The answer still arrives without docs; it clears within a minute.
- **The site doesn't load:** check `fly status`; if the machine is stopped or crashed, `fly apps restart temporal-quest`. Restarts don't lose learners' work, which lives in their sandboxes.

## After

- Set `min_machines_running` back to `0` and merge it, so the machine stops when idle. Re-enable the **Deploy** workflow if you disabled it.
- Sandboxes stop after 30 idle minutes and are deleted 24 hours after creation. To delete them all now, filter Daytona's dashboard by label `app=governance-course`.
- The cohort's end date closes it on its own. To let its learners carry on, clear the date (or move them to the On-demand cohort).
