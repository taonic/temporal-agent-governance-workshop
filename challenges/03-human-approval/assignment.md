---
slug: human-approval
type: challenge
title: "3 · Human approval mode"
teaser: Make bookings wait for a person, safely, for as long as it takes. Then notice how many times you clicked.
timelimit: 2100
---

# Human approval mode

An agent that books travel on its own judgment needs a human in the loop. That sounds simple until you build it. The human might answer in five seconds or five hours, and your servers might be redeployed in between. The approve button might be clicked twice, or after the agent has moved on.

The harness already handles the hard parts:

- An approval is a Temporal **Update** (`tool_approval`). Unlike a Signal, it returns an answer, so the clicker learns whether it counted.
- A **validator** runs before anything is written to history, and rejects a decision for a call that isn't pending, or was already decided.
- The agent **waits durably**: a workflow blocked on an approval costs nothing, and survives restarts.

Your job is the policy: what needs approval. First, see what happens when everything does.

<!-- local -->Starting here, without exercises 1 and 2 done? Run `./challenges/03-human-approval/setup.sh` first: it solves each of them you haven't, and leaves the ones you did alone. Then restart the worker.<!-- /local -->

## 1. Approve everything

Start the worker if it isn't running (`uv run travel-worker`). In the console, start a new session with the posture **`human_approval_only`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="human_approval_only" title="Open the Travel agent's start form in the Agent UI, with human_approval_only chosen">New session ▸</button>
-->, and ask:

> Book the cheapest flight from SFO to JFK on 2026-11-01 for Ada Lovelace.

Count the approvals. The agent's script needs approving. So does the search inside it, then the booking, and then each note it writes to the trip board. If the agent asks for the trip form, that needs approving too. It's safe, but it's not usable. Nobody reads the fifth "approve search_flights?" card.

## 2. Ask only about what matters

Open `travel_agent/agent/workflow.py` and find `TODO(ch03)` in `approval_policy()`, under the `approve_bookings` posture. Make it allow the calls that can't change anything in the world, by name, so only bookings wait for you:

```python
# An allow list: these calls run without asking. Anything else (the bookings) waits for a
# person, who answers with the tool_approval Update.
return ToolApprovalPolicy.allow_tools(
    [
        *PRE_APPROVED_TOOLS,       # the trip board, the notes, the trip form
        CODE_MODE_TOOL_NAME,       # the script itself: each call it makes is still judged on its own
        "search_flights",          # lookups: they can't change anything in the world
        "search_hotels",
        "get_trip_summary",
    ]
)
```

Allowing `run_travel_code` is safe because writing and running a script does nothing by itself. Every travel function the script calls goes through the approval gate again, under its own name. So a script that searches and then books runs the search unattended and stops at the booking.

Restart the worker, and try it.

## 3. Approve one, reject one

Start a new session with the posture **`approve_bookings`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="approve_bookings" title="Open the Travel agent's start form in the Agent UI, with approve_bookings chosen">New session ▸</button>
--> (or, in an existing session, send the `set_approval_policy` message with `approve_bookings`) and ask the same thing.

The search runs unattended, and the booking pauses with an approval card. **Approve** it: the booking runs, and the agent confirms.

Now ask for a hotel:

> Book Ada a hotel in New York from 2026-11-01 to 2026-11-05.

**Reject** it, with a reason. The agent tells you it didn't book, and why: your reason reached the model as the tool's error. In the harness, the approval gate [waits for your decision, then raises `ToolApprovalDenied` with your reason](https://github.com/temporal-community/temporal-agent-harness/blob/15da54ee8e2baff0370ca245e9da1e29ba831ab8/temporal_agent_harness/harness/agent_workflow.py#L615-L635), and [that exception's message](https://github.com/temporal-community/temporal-agent-harness/blob/15da54ee8e2baff0370ca245e9da1e29ba831ab8/temporal_agent_harness/harness/agent_workflow.py#L331-L335) is the error the model sees.

You answered within seconds. What if you take an hour?

## 4. Wait as long as it takes

Ask for another booking:

> Book the cheapest flight back from JFK to SFO on 2026-11-05 for Ada Lovelace.

When the approval card appears, **stop the worker**. Wait a minute. Click **Approve**: the console waits, because an Update needs a worker to run its validator. Start the worker, and the approval goes through and the booking runs.

The session sat waiting with no process running at all. While a workflow waits it costs nothing; it could wait days. And every decision you make is on record.

## 5. Read the audit trail

The session's history<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=update">Updates ▸</button>
--><!-- local --> in the Temporal UI<!-- /local --> shows each `tool_approval` Update and what was decided: the approval, and the rejection with its reason. Approval is part of the history, next to the booking it allowed.

It works. But count the clicks.

## The catch

You're now asked about every booking, and you clicked approve on every one that matched what you'd asked for. If the agent books ten things, that's ten clicks, each a chance to stop reading. **Human approval is safe, but it gets noisy fast.** Exercise 4 asks a better question.

## Check

```bash
./challenges/03-human-approval/check.sh
```

It checks your `approve_bookings` posture: lookups and the script run unattended, a booking waits and runs once approved, a second click is turned away, and a rejected booking isn't made.
