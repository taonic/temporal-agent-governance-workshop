# 01 · Personas, and the map each one sees

Status: done (2026-11-11), awaiting review
Spec: [../spec.md](../spec.md) (Personas)

## What

- Content: `personas:` on `branch.md` (none means `[developer]`), and on `badges.yaml` entries (none means every persona). A path's personas are its modules' branches'. `content/build.mjs` checks them and writes them into the course data.
- `store.js` exports a `course` filtered by the learner's persona: branches, modules, paths, exercises and badges. It is the only place the site filters, and switching persona reloads the page.
- The persona is read from `?persona=`, then the cohort (once it can set one), then what the learner chose (saved in the browser, and on the server as a `persona_set` event that `/api/progress` returns).
- The choice: two cards after the welcome intro's Start, before the map, for a learner who hasn't chosen yet. "I build software" or "Why Temporal?".
- Switching: the account menu, and the map's rail for signed-out visitors.
- The map, focus view, first-run view, phone list and welcome intro work with Essentials as the only (one-tier) trunk.

## Done when

A new visitor picks a persona and sees only that persona's branches, everywhere the site lists them. A signed-in learner's persona follows them to another browser. Switching keeps progress. Unit tests cover the filtering and the build's checks; the Developer persona's map is unchanged.

## Comments

**2026-11-11, built.** `quests/personas.yaml`; `personas:` on branches and skill badges, paths' personas worked out by the build (`content/build.mjs` refuses a module that builds on one its persona can't see). `web/src/persona.js` (`courseFor`, `readPersona`) filters the `course` that `store.js` exports. `PersonaChoice.vue` asks after the intro (not under `navigator.webdriver` unless `?persona-choice`). Switch from the account menu or the map's rail. `persona_set` events (`runner/activity.mjs`), and `/api/progress` returns `persona`: the learner's choice, else their cohort's path's. The map's trunk layout wraps a one-tier trunk, and hides the junction with no specializations.

Not done: a cohort setting a persona directly (it comes from the cohort's path today).
