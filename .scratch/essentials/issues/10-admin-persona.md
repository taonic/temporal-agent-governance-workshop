# 10 · Persona in the admin journey

Status: done (2026-11-11), awaiting review
Blocked by: 01
Spec: [../spec.md](../spec.md) (Admin)

## What

A learner's journey shows their persona and when it changed (from `persona_set` events); the learners list filters by persona.

## Done when

An admin can see how many learners are on each persona, and filter to one.

## Comments

Built 2026-11-11. `/api/admin/learners` takes `persona`, each row carries it, and the summary counts learners per persona (everyone's, to filter by); the CSV has a persona column. A journey has `persona` and `personaChanges` (from `persona_set`), shown as "Learning as" with when it last changed; the timeline names the persona. The admin page now reads the full course, so module titles show whatever the admin's own persona. Test in accounts.test.mjs.
