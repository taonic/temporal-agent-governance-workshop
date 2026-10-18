# End-to-end tests

Playwright tests of the deployed course site, as a learner uses it: the live Fly app (`https://temporal-agent-governance-workshop.fly.dev`) unless `E2E_BASE_URL` says otherwise. Why they're built this way, and what to update when the workshop changes: [../DESIGN.md](../DESIGN.md#end-to-end-tests-added-2026-10-18).

| Tier | Needs | What it does | Time |
|---|---|---|---|
| `@public` | nothing | the `/api` signed out, every page in the picker, the access form, Ask Temporal's panel, theme | ~20 s |
| `@auth` | `E2E_ACCESS_CODE` | a fresh learner's session, without a sandbox; Ask Temporal answers (only if the app has `KAPA_API_KEY`); `/api/admin/sandboxes` (with `E2E_INSTRUCTOR_CODE`) | ~10 s |
| `@sandbox` | `E2E_ACCESS_CODE` | a real Daytona sandbox: start it from the page, both terminals, the Temporal UI and Agent UI panes, then `solve.sh` and ✓ Check for every exercise with a check. Deletes the sandbox at the end | ~10–25 min |

A tier without its secret skips.

## Run them

```bash
cd course/e2e
npm ci
npx playwright install chromium

npm run test:public                          # no secrets
E2E_ACCESS_CODE=... npm run test:auth        # + the signed-in tier
E2E_ACCESS_CODE=... npm test                 # everything, sandbox included
npm run report                               # the HTML report of the last run
npm run summary                              # reports/summary.md (and reports/email.json, see below)
```

| Variable | |
|---|---|
| `E2E_BASE_URL` | the site to test (default: the live Fly app) |
| `E2E_ACCESS_CODE` | one of the app's `ACCESS_CODE` codes: keep one for the tests in the list ([DEPLOY.md](../DEPLOY.md)) |
| `E2E_INSTRUCTOR_CODE` | the app's `INSTRUCTOR_CODE`, for the admin test |
| `E2E_SKIP_SANDBOX` | `1` keeps the sandbox tier off |

Failures keep a trace, a screenshot and a video (`test-results/`); the sandbox tier also attaches both terminals' text. `npx playwright show-trace test-results/<test>/trace.zip` replays one.

## Every day, by email

`.github/workflows/e2e.yml` runs every tier at 14:00 UTC and emails the result, pass or fail: a subject like `✅ Course e2e passed · temporal-agent-governance-workshop.fly.dev · 2026-10-18`, each tier's result, each failure's error, and a link to the run (the HTML report and traces are its artifacts). It also runs after every deploy (emailing only a failure) and can be run by hand: Actions → E2E → Run workflow.

To turn it on, in the repository's Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| secret | `E2E_ACCESS_CODE` | a code you add to the app's list: `fly secrets set ACCESS_CODE=<event codes>,<this>` |
| secret | `E2E_INSTRUCTOR_CODE` | optional: the app's `INSTRUCTOR_CODE` |
| secret | `RESEND_API_KEY` | a [Resend](https://resend.com/api-keys) API key with sending access |
| variable | `E2E_MAIL_TO` | where the email goes, comma-separated |
| variable | `E2E_MAIL_FROM` | `onboarding@resend.dev`, or an address on a domain you've verified in Resend |
| variable | `E2E_SKIP_SANDBOX` | `1` during an event; delete it after |

The email goes through [Resend](https://resend.com)'s API (`POST /emails`, with `curl`). Resend's test sender, `onboarding@resend.dev`, only delivers to the address the Resend account signed up with; to send to anyone else (a team list, say), [verify a domain](https://resend.com/domains) and send from an address on it.

To send the last run's email from your machine:

```bash
E2E_MAIL_FROM=onboarding@resend.dev E2E_MAIL_TO=you@example.com npm run summary
curl https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" --data @reports/email.json
```

Without `RESEND_API_KEY` the run still works and says so; GitHub's own notifications then email a failed scheduled run to whoever last changed the workflow's `cron` line.
