# 04d · Learner journeys and activity in /admin

Status: ready-for-human
Blocked by: 04b
Spec: [../spec.md](../spec.md) (Accounts, cost and events)

Replaces the spec's `/instructor` view. It's for admins (`ADMIN_EMAILS`).

## What

- **The Learners tab** can be filtered by cohort. Each learner is one row: name, email, role, company, cohort, current module, minutes on it, modules passed, XP, sandbox time today, and last active. Anyone **stuck for more than 10 minutes** is highlighted: on the same module for more than 10 minutes by heartbeat (04b) without passing it. The tab has an **Export CSV** button (name, email, role, company, cohort, modules passed, XP, last active).
- **The cohort summary** sits above the table. It shows how many learners have passed each module along the cohort's path (or every module, when the cohort has no path). For each challenge it shows the first-try right rate and the most-picked wrong choice ([08](08-run-it-challenges.md)).
- **A learner's journey** opens by clicking a row. It shows:
  - modules passed, in order, with the time each took
  - failed checks
  - challenge picks
  - boss results
  - sandbox sessions and their length
  - helper questions asked (the count)
  - a timeline of their events
- **The Activity tab** is a live feed of all events, newest first. It can be filtered by cohort, learner and event type.
- **Delete learner** is a button on the journey page that asks for confirmation. It removes the user, their events and their allowlist entry if it's an exact email. The deletion itself is logged without the email.

## Done when

During an e2e run with several learners, the Learners tab updates within 10 seconds, shows each learner's current module, and highlights a learner held on one module for more than 10 minutes (with the clock faked in the test). A journey page matches what the learner did. The CSV opens in a spreadsheet with one row per learner. Deleting a learner removes every row about them.

## Comments

- 2026-11-10: Implemented, not committed. Awaiting review.
  - **Code:** `admin.mjs` and `web/src/pages/AdminPage.vue`. It refreshes every 10 seconds while the tab is visible, but not while a cohort form is being edited.
  - **Summary:** "Passed, per module" lists the cohort's path, or with no path (or all cohorts), only the modules someone has passed.
  - **Deleting a learner** also deletes their sandbox, and replaces their email in the admin log with "(deleted)".
  - **Verified:**
    - Unit tests cover "stuck" with a moved clock.
    - The e2e test checks the Learners tab's current module, the journey, the CSV and blocking.
    - Not tested: "stuck" in e2e, and the live update with several learners in one run.
