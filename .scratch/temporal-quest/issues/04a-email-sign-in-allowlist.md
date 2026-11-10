# 04a · Email sign-in, allowlist and cohorts

Status: ready-for-human
Blocked by: none
Spec: [../spec.md](../spec.md) (Accounts, cost and events)

Blocks 04b–04g. Replaces the access code and the instructor code.

## What

- **SQLite on a Fly volume.** One database file on a volume mounted in the app (`[mounts]` in `course/fly.toml`, region `sjc`). Use `node:sqlite` (bump the image and `engines` to a Node that has it unflagged), or `better-sqlite3` if that falls short. Schema migrations run at startup. Backups are Fly's daily volume snapshots.
- **Users.** A user has a random id, an email (lowercased), a name, a role, a company (inferred from the email's domain), a cohort and a status (`active`, `blocked`). The random id labels the sandbox and signs the model key, as the learner id does today. The email never leaves the database, so Daytona never sees it.
- **Sign-in with a code by email.** The learner enters an email and gets a 6-digit code through Resend, from a verified `temporalquest.dev` address (`RESEND_API_KEY`, a sender such as `Temporal Quest <signin@temporalquest.dev>`).
  - A code is valid for 10 minutes and works once. It allows 5 wrong tries. It is stored hashed.
  - Sends are limited to 3 per email per 15 minutes, plus a per-IP limit.
  - At the first sign-in, the learner gives a name and a role. Role is a dropdown: Developer, Architect, Engineering manager, Platform/SRE, Data/ML, Other.
  - The form says: "We use your email to sign you in and track your course progress." It offers no marketing opt-in.
- **The allowlist.** An entry is an exact email or a domain rule (`@temporal.io`). Each entry belongs to a **cohort**. A cohort has a name, an optional path, an optional end date and a daily sandbox allowance (8 hours unless set; enforced in 04f). After a cohort's end date, its entries can't sign in. `ADMIN_EMAILS` (a comma-separated Fly secret) are always allowed and are the admins.
- **Unlisted emails.** For now, an email that isn't on the allowlist gets "This email isn't registered yet" and no code. 04c replaces this with the access request.
- **Session.** The cookie holds a signed `userId.issuedAt.sig` and lasts 14 days from sign-in, without sliding. Every request checks its age and looks the user up. A blocked user, or one no longer allowed (removed entry, ended cohort), is signed out on their next request. Rotating `SESSION_SECRET` signs everyone out.
- **What the sign-in gates.** It gates what the access code gates today: sandboxes and Ask Temporal. The reading gate is 04e.
- **Cutover.** Sessions from the access code stop working, so everyone signs in once and gets a new sandbox. localStorage progress is untouched. Remove `ACCESS_CODE`, `INSTRUCTOR_CODE` and `ALLOW_OPEN_ACCESS`. `AccessForm.vue` becomes the email, code and profile flow. Update `course/DEPLOY.md`, `course/DESIGN.md`, `course/README.md` and the root `README.md`, which describe the access code.
- **`/admin`** is a route in the Vue app, for `ADMIN_EMAILS` only. It uses `/api/admin/*` and refreshes every 10 seconds. This issue builds two tabs:
  - **Cohorts & allowlist:** create, edit and end cohorts; paste emails or domain rules one per line into a cohort; remove entries; block or unblock a user.
  - **Sandboxes:** today's `GET /api/admin/sandboxes`, now behind the admin session.

  Admin actions are logged with the admin's email (in the events table if 04b has landed, otherwise in a small `admin_log` table that 04b folds in).
- **No mailbox needed in tests or locally.**
  - **e2e:** for emails matching `e2e+*@temporalquest.dev`, the server sends nothing and accepts a code derived from the `E2E_SIGNIN_KEY` secret. The e2e admin's address goes in `ADMIN_EMAILS`. The `@auth` and `@sandbox` tiers sign in this way instead of with `E2E_ACCESS_CODE`.
  - **Local runner:** without `RESEND_API_KEY`, the runner prints the code to its console and skips the allowlist.

## Done when

A listed email signs in with the emailed code. A first sign-in asks for name and role. The session lasts 14 days. Blocking a user in `/admin` signs them out on their next request. An unlisted email is turned away. A cohort past its end date can't sign in. An old access-code cookie is refused. The e2e `@auth` and `@sandbox` tiers pass with `E2E_SIGNIN_KEY`, and an e2e test adds an email to a cohort in `/admin`. Unit tests cover the cookie (expiry, tampering), the code (expiry, tries, single use, rate limits) and the allowlist matching (email, domain, end date, admins).

## Before production (human)

- **DNS:** verify `temporalquest.dev` in Resend by adding its DNS records.
- **Fly secrets:** set `RESEND_API_KEY`, `ADMIN_EMAILS` and `E2E_SIGNIN_KEY`.
- **GitHub secret:** set the repository secret `E2E_SIGNIN_KEY`.
- **Fly volume:** create it in `sjc`.

## Comments

- 2026-11-10: Implemented, not committed. Awaiting review.
  - **Runner:** `db.mjs` (SQLite through `node:sqlite`; the image's Node 22.23 has it, and `engines` is now `>=22.13`), `accounts.mjs`, `mailer.mjs` and `admin.mjs`. The session cookie is in `auth.mjs`.
  - **Deviations:**
    - 04c was built at the same time, so an unlisted company email gets a code and the access request instead of "not registered yet".
    - Added a limit of 10 wrong codes per email per 15 minutes, across codes. e2e addresses skip the send limits (CI signs in many learners from one IP), and their code is the same every time, so without this limit it could be brute-forced.
    - `/admin` has every tab now (04c and 04d too).
  - **Fly:** `[mounts]` on `quest_data` at `/data`, and `DATABASE_PATH=/data/quest.db`. The image now starts as root to hand `/data` to `node`, then runs as `node` (`runuser`, checked in `node:22-bookworm-slim`).
  - **Verified:**
    - `npm test` passes, 102 tests, including `tests/accounts.test.mjs`.
    - e2e `@public` and `@auth` ran against a local production-like runner (dist served, a dummy `RESEND_API_KEY`, `E2E_SIGNIN_KEY`): 41 passed, 1 skipped (Ask Temporal's answer needs `KAPA_API_KEY`).
    - Screenshots at 1440 and 390, light and dark.
  - **Not verified:** a real email from Resend (the domain isn't verified yet), the volume on Fly, and the `@sandbox` tier.
