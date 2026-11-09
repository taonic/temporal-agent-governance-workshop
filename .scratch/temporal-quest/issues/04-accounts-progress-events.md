# 04 · Sign-in, server progress, events

Status: ready-for-agent
Blocked by: 02, 03
Spec: [../spec.md](../spec.md) (Accounts, cost and events; Sandbox state: save points)

## What

- GitHub and Google sign-in. Progress, XP and quiz results stored in SQLite on a Fly volume. Anonymous localStorage progress is merged in at the first sign-in.
- Reading needs no sign-in. Sandboxes need a sign-in and come with a daily allowance (sandbox runtime and model calls). This replaces access codes as the gate.
- Event codes raise the allowance for the day and set the learner's path.
- The sandbox starts warming in the background when a signed-in learner lands on the map. Entering a module applies its save point with a toast. If the learner's own edits would be overwritten, the site asks first and keeps them as a git commit in the sandbox.
- Sandboxes are disposable: progress no longer depends on the sandbox's `.course/passed` markers.
- `/instructor` (instructor code): learners on the event's path, current module, XP, minutes on that module, anyone stuck for more than 10 minutes highlighted, and how many have passed each module.

## Done when

Progress follows a learner across browsers. A learner who has used up their allowance can still read but can't start a sandbox. An event code works end to end. The instructor view updates live during an e2e run with several learners.

## Comments

- 2026-11-07: [08](08-run-it-challenges.md) adds challenges. The server keeps each challenge's picks with the rest of progress (`attempts: ["B", "C"]`, from localStorage at first sign-in), and `/instructor` shows each challenge's first-try right rate and most-picked wrong choice.
