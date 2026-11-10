# 04e · Public map and the reading gate

Status: ready-for-human
Blocked by: 04a, 02
Spec: [../spec.md](../spec.md) (Accounts, cost and events)

## What

- **The map is public.** Without signing in, a visitor sees the branches, module titles and one-line teasers, the path highlight and the boss nodes. That's enough to show the scope of the course.
- **Module pages need a signed-in, active learner.** Clicking a module while signed out opens the sign-in panel and returns to that module afterwards. A `pending` learner (04c) sees the map with its banner. The setup page and the home page's introduction stay public.
- **The gate is soft.** Module text stays in the bundle, and the repo stays public. The gate is for converting visitors into sign-ups and tracking journeys, not for secrecy. Don't move content behind the API.
- Ask Temporal's panel stays gated as in 04a. Signed out, it still shows how to add the docs server to an editor.

## Done when

A signed-out visitor can browse the whole map and is sent to sign-in on clicking a module, then lands on that module. The e2e `@public` tier covers the map and the redirect.

## Comments

- 2026-11-10: Implemented, not committed. Awaiting review.
  - **The gate:** signed out, an exercise or module route shows a sign-in card in place of the page, and opens the module once the learner is signed in.
  - **The top bar** has Sign in (signed out), or the account menu: email, cohort, Admin panel for admins, and Sign out.
  - **Pending:** a learner waiting on a request, rejected, or in an ended cohort gets a banner over the map.
  - **e2e:** `@public` covers the map, the gate and a personal email. The module tests moved to a signed-in block (`signedIn`), which stubs the sandbox calls so no Daytona sandbox starts.
