# End-to-end tests

Playwright tests of the deployed course site, as a learner uses it: the live Fly app (`https://temporalquest.dev`) unless `E2E_BASE_URL` says otherwise. Why they're built this way, and what to update when the workshop changes: [../DESIGN.md](../DESIGN.md#end-to-end-tests-added-2026-10-18).

| Tier | Needs | What it does | Time |
|---|---|---|---|
| `@public` | nothing | the `/api` signed out, the map, the setup page, a module's sign-in (and a personal email turned away), theme | ~20 s |
| `@auth` | `E2E_SIGNIN_KEY` | new learners signed in, without a sandbox: every exercise page, a challenge, Next and paths, Ask Temporal's panel (and an answer, only if the app has `KAPA_API_KEY`), progress on the server, sign-in through the page, an access request approved, and the admin: the allowlist through `/admin`, a learner's journey, blocking, the sandboxes list | ~30 s |
| `@sandbox` | `E2E_SIGNIN_KEY` | a real Daytona sandbox: sign in and start it from the page, both terminals, the Temporal UI and Agent UI panes, then every exercise the way its instructions say, step by step through the page with the real model, ending with its ✓ Check (`tests/walkthroughs.mjs`). Deletes the sandbox at the end | ~20–30 min |

A tier without its secret skips. Each signed-in test signs in a learner of its own (`e2e+<test>-<random>@temporalquest.dev`; no email is sent, the code comes from `E2E_SIGNIN_KEY`), which the tests' admin puts on the allowlist in an `E2E` cohort and deletes after. The admin's tests skip when `E2E_ADMIN_EMAIL` isn't one of the app's `ADMIN_EMAILS`.

## Run them

```bash
cd course/e2e
npm ci
npx playwright install chromium

npm run test:public                          # no secrets
E2E_SIGNIN_KEY=... npm run test:auth         # + the signed-in tier
E2E_SIGNIN_KEY=... npm test                  # everything, sandbox included
npm run report                               # the HTML report of the last run
npm run summary                              # reports/summary.md (and reports/email.json, see below)
```

| Variable | |
|---|---|
| `E2E_BASE_URL` | the site to test (default: the live Fly app) |
| `E2E_SIGNIN_KEY` | the app's `E2E_SIGNIN_KEY` ([DEPLOY.md](../DEPLOY.md)) |
| `E2E_ADMIN_EMAIL` | the tests' admin, one of the app's `ADMIN_EMAILS` (default `e2e+admin@temporalquest.dev`) |
| `E2E_SKIP_SANDBOX` | `1` keeps the sandbox tier off |

Failures keep a trace, a screenshot and a video (`test-results/`); the sandbox tier also attaches both terminals' text and the Agent UI's chat. A step whose instructions the page can't follow as written is noted in the report (an `instructions` annotation) without failing the run. `npx playwright show-trace test-results/<test>/trace.zip` replays one.

## Every day, by email

`.github/workflows/e2e.yml` runs every tier at 14:00 UTC and emails the result, pass or fail: a subject like `✅ Course e2e passed · temporalquest.dev · 2026-10-18`, each tier's result, each failure's error, and a link to the run (the HTML report and traces are its artifacts). It also runs after every successful deploy, as its own workflow so it never holds up the next one (emailing only a failure) and can be run by hand: Actions → E2E → Run workflow.

To turn it on, in the repository's Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| secret | `E2E_SIGNIN_KEY` | the app's `E2E_SIGNIN_KEY` |
| variable | `E2E_ADMIN_EMAIL` | optional: one of the app's `ADMIN_EMAILS` (default `e2e+admin@temporalquest.dev`) |
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
