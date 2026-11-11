# 07 · E3–E8 and the closing beat

Status: done (2026-11-11), awaiting review
Blocked by: 04 (its review), 05, 06
Spec: [../spec.md](../spec.md) (Modules, Ending)

## What

E3–E8 on the same story and board (the twin in E3–E5; a "Without Temporal, this would…" box in E6–E8), the timer, approval and saga variants of the booking trip, and the closing beat "Spot it in your business": three scenarios with reveals, the optional "a process of yours" box, and the end card.

## Done when

The branch plays end to end in a sandbox in about 50 minutes, and its tier badge can be earned.

## Comments

Built 2026-11-11. E3 (flaky airline, twin gives up), E4 (`onShift: false`, twin's request dropped), E5 (pull the plug, twin double-books), E6 (`hold`: hold_seat + a 30s durable timer), E7 (`approval`: the `decide` signal, Approve/Reject on the board), E8 (`declined`: non-retryable CardDeclined, cancel hotel then flight, workflow fails "undone"). "Without Temporal" boxes in E6–E8; chips name durable timer, signal and saga. The closing beat is E8's last three sections (scenarios as `<details>`, "a process of your own" asking Ask Temporal, the end card with `#share` and `#persona/developer`). Every module played end to end on a dev server and on the snapshot's image; the branch is about 52 minutes. Section titles are unique across the exercise (the build now refuses duplicates).
