# Deploying the course site to Fly.io

The runbook for hosting the browser course (`course/`) for an event: first deploy, the checklist before each session, what to watch during it, and cleanup. For every setting and why the site is built this way, see [course/DEPLOY.md](../course/DEPLOY.md) and [course/DESIGN.md](../course/DESIGN.md).

## What runs where

```
learner's browser ──▶ Fly app: temporal-agent-governance-workshop  (one machine, one Node process)
                        :443  the site, /api, the model passthrough (/llm/v1)
                        :8081 the Temporal UI proxy
                              │
                              ├──▶ Daytona: one sandbox per learner (2 vCPU / 4 GB, from a snapshot)
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
fly apps create temporal-agent-governance-workshop

export DAYTONA_API_KEY=... GEMINI_API_KEY=... ACCESS_CODE=... INSTRUCTOR_CODE=...

fly secrets set --app temporal-agent-governance-workshop \
  DAYTONA_API_KEY="${DAYTONA_API_KEY:?set DAYTONA_API_KEY}" \
  GEMINI_API_KEY="${GEMINI_API_KEY:?set GEMINI_API_KEY}" \
  ACCESS_CODE="${ACCESS_CODE:?set ACCESS_CODE}" \
  INSTRUCTOR_CODE="${INSTRUCTOR_CODE:?set INSTRUCTOR_CODE}" \
  SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}" \
  ${KAPA_API_KEY:+KAPA_API_KEY="$KAPA_API_KEY"}
```

`SESSION_SECRET` is generated when you haven't exported one, which is right for the first deploy only. To change other secrets later, set just those (`fly secrets set ... ACCESS_CODE="$ACCESS_CODE"`). Re-running the whole command without `SESSION_SECRET` exported makes a new one, which signs everyone out. `KAPA_API_KEY` is included only when it's set.

| Secret | What happens without it |
|---|---|
| `DAYTONA_API_KEY` | no sandboxes; the site is read-only |
| `GEMINI_API_KEY` | no model for the agents, no Ask Temporal |
| `ACCESS_CODE` | the browser runtime is off (reading still works). Takes several codes, comma-separated (`cohort-a,cohort-b`); any one works |
| `SESSION_SECRET` | a random one per restart, so every restart signs everyone out. Set it once and leave it: changing it signs everyone out and breaks running sandboxes' model keys until they restart |
| `INSTRUCTOR_CODE` | no admin view of sandboxes |
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

Keep it to **one machine**: `--ha=false` does that, and `fly scale count 1 --app temporal-agent-governance-workshop` fixes it if a second appears. The runner holds terminal connections and rate limits in memory; two machines would each hold half of them.

### 4. Smoke test

```bash
curl https://temporal-agent-governance-workshop.fly.dev/api/health
# {"ok":true,"runtime":{"enabled":true},...}
```

`runtime.enabled: false` means a missing `DAYTONA_API_KEY` or `ACCESS_CODE`. Then open the site, enter the access code, start a sandbox in exercise 1, and run the worker. Press ⌘K and ask Ask Temporal one question: it should search the docs, cite and link.

## Automatic deploys

After the first deploy, every merge to `main` deploys itself: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) builds the sandbox snapshot if needed, deploys to Fly, then checks `/api/health`. Changes only under `instructor/` don't deploy. To deploy by hand from GitHub: Actions → **Deploy** → **Run workflow**.

It needs two repository secrets (Settings → Secrets and variables → Actions):

```bash
# A deploy token scoped to this app
fly tokens create deploy --app temporal-agent-governance-workshop
gh secret set FLY_API_TOKEN      # paste the token
gh secret set DAYTONA_API_KEY    # for the snapshot build
```

The app's own secrets (`GEMINI_API_KEY`, `ACCESS_CODE`, ...) stay in Fly; CI never sees them.

**A deploy restarts the runner.** Learners keep their sandboxes and stay signed in, but their terminals reconnect. Don't merge to `main` during a session. If you need to block deploys for the day, disable the workflow: `gh workflow disable deploy.yml` (and `gh workflow enable deploy.yml` after).

## Before an event

**A week before**

- **Daytona quota.** 40 sandboxes × 2 vCPU × 4 GB is 80 vCPU and 160 GB at peak. Check the org's limits; the shared GPU endpoint, if you run it, uses the same quota. Lower `MAX_SANDBOXES` in `fly.toml` (and deploy) to fit the room.
- **Gemini budget.** Set a cap on the Google project and check its balance. An empty prepaid balance answers 402, which stops both the agents and Ask Temporal. The runner's rate limits (20 calls a minute per sandbox, 300 overall) slow a runaway loop; only the cap stops it.

**The day before**

- **Make sure the version you'll teach is deployed:** the latest **Deploy** run on `main` passed (or run `npm run deploy`, after `npm run snapshot` if dependencies changed). Freeze `main` or disable the workflow until after the session. A deploy whose snapshot doesn't exist fails at "Creating your sandbox", with the snapshot name in the error.
- **A fresh access code:**

  ```bash
  fly secrets set --app temporal-agent-governance-workshop ACCESS_CODE=<event-code>
  ```

  Setting a secret restarts the machine. Signed-in learners stay signed in and sandboxes survive (the runner finds them again by their Daytona labels).

  Running more than one session at once (two rooms, or a morning and an afternoon cohort)? Give each its own code, comma-separated: `ACCESS_CODE=sf-morning,sf-afternoon`. Any listed code lets a learner in. Removing a code stops new sign-ins with it; learners already signed in stay signed in. Codes can't contain commas.
- **Run the smoke test** above end to end, including one exercise check.

**On the day, about 30 minutes before**

- **Keep the machine warm.** By default Fly stops the machine when idle (`min_machines_running = 0`), and the first visitor waits a few seconds. For the event, set `min_machines_running = 1` in `course/fly.toml` under `[http_service]` and merge it to `main`, which deploys it (do this before you freeze `main`). Set it back to `0` afterwards. A local `npm run deploy` of an uncommitted change works too, but the next CI deploy undoes it.
- **Check who's in** as learners arrive:

  ```bash
  curl -s -H "x-instructor-code: $INSTRUCTOR_CODE" \
    https://temporal-agent-governance-workshop.fly.dev/api/admin/sandboxes
  ```

  It lists each sandbox, its state and the exercise its learner last had open, against `max`.

## During the event

| Need | Command |
|---|---|
| Live logs | `fly logs --app temporal-agent-governance-workshop` |
| Machine state | `fly status --app temporal-agent-governance-workshop` |
| Restart the runner | `fly apps restart temporal-agent-governance-workshop` |
| Shell on the machine | `fly ssh console --app temporal-agent-governance-workshop` |
| Roll back | `fly releases --app temporal-agent-governance-workshop --image`, then from the repo root `fly deploy --config course/fly.toml --image <image-ref>` |

**When something breaks**

- **"Creating your sandbox" fails with a snapshot name:** the snapshot for this deploy doesn't exist. Run the **Sandbox snapshot** workflow (or `npm run snapshot`); no redeploy is needed. CI deploys build it first, so this only happens after a manual `npm run deploy`.
- **Sandboxes fail to start for everyone:** the Daytona quota or `MAX_SANDBOXES` is full. Check the admin list and Daytona's dashboard.
- **The agent stops answering (402s or 429s in the logs):** Gemini credit or quota. Learners can switch their sandbox to the scripted model from the sandbox menu in the top bar; it plays every walkthrough, including the injection.
- **Ask Temporal says the search is busy:** the Kapa team limit (60 a minute). The answer still arrives without docs; it clears within a minute.
- **The site doesn't load:** check `fly status`; if the machine is stopped or crashed, `fly apps restart temporal-agent-governance-workshop`. Restarts don't lose learners' work, which lives in their sandboxes.

## After

- Set `min_machines_running` back to `0` and merge it, so the machine stops when idle. Re-enable the **Deploy** workflow if you disabled it.
- Sandboxes stop after 30 idle minutes and are deleted 24 hours after creation. To delete them all now, filter Daytona's dashboard by label `app=governance-course`.
- Optionally rotate `ACCESS_CODE` so the event's code stops working.
