# 03 · The Trip board

Status: done (2026-11-11), awaiting review
Blocked by: 02
Spec: [../spec.md](../spec.md) (The page: the Trip board)

## What

- A `board` exercise layout (from the branch: `layout: board`): the workspace shows the Trip board and the Temporal UI tab, with no editor, no terminals, and no Code tab.
- The board: the Temporal trip's logbook as steps that tick off, the coordinator on or off shift, the plain twin's trip beside it when the module uses one, the outside-world panel, and the action buttons.
- In the guide, `[label](#board/<action>)` renders as the same action button, painted with the board's state.
- Light and dark, and a phone width (the board stacks above the guide).

## Done when

In a sandbox, a learner can run a trip, pull the plug, and watch the board and the Temporal UI agree. Unit tests cover the board's view model (from a poll's state to what each panel shows).

## Comments

**2026-11-11, built.** `TripBoard.vue`, its view model `boardView` in `web/src/board.js` (`tests/board.test.mjs`). A `layout: board` branch's exercise shows the board in place of the editor and the terminal dock, polls every 2.5s, and sets the module's board up on arrival. `#board/<action>` links in a module's text are the same buttons (`content/build.mjs`; the build refuses an unknown action). Light, dark and phone checked in Chromium against a real local Temporal.

Known, not from this change: a module page's top bar is wider than a phone (390px) on every exercise page.
