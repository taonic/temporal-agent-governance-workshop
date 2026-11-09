# 07 · Rename and redeploy as temporal-quest

Status: ready-for-human
Blocked by: 01, 02, 03, 04, 05, 06
Spec: [../spec.md](../spec.md) (Product)

## What

Rename the GitHub repo and the Fly app to `temporal-quest`, deploy, and redirect the old URL to the new one. Update README, DESIGN docs, the home page hero ("4 hours, hands-on" no longer fits) and the sandbox label `app=governance-course`.

Comes last so the live workshop URL keeps working until the new site is ready. Needs a human for the GitHub and Fly account actions (the rename, the new app and its secrets, DNS).

## Done when

The new URL serves Temporal Quest, the old one redirects to it, and an event runs on the `agent-governance-4h` path.
