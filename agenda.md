Here’s the shape I’d use: **4 core exercises + 1 optional capstone**, in a 4-hour workshop.

The spine is:

> Raw Temporal → Monty agent session → human approval → Dogwood auto mode → prompt-injection/policy capstone.

**Workshop Title**
**Governed Agents With Temporal, Monty, And Dogwood**

**Core Promise**
By the end, participants understand how Temporal makes agent sessions durable, how Monty packages agent workflows, and how Dogwood lets agents act automatically only when policy and prior user intent allow it.

**Detailed Outline**

| Time | Section | Format | Goal |
|---:|---|---|---|
| 0:00-0:10 | Opening | Instructor | Frame the problem: agents need durability, approvals, audit, and safe autonomy |
| 0:10-0:45 | **Exercise 1: Hello Temporal** | Hands-on | Build/run a tiny workflow, activity, worker, client |
| 0:45-0:55 | Temporal Debrief | Instructor | Explain history, retries, timers, workers, signals/updates/queries |
| 0:55-1:00 | Introduce Monty | Instructor | “Monty is the agent-shaped harness on top of Temporal” |
| 1:00-1:45 | **Exercise 2: Durable Travel Agent Session** | Hands-on | Run a script in the Monty sandbox (Code Mode), then a Monty travel agent session, and inspect it in Temporal |
| 1:45-1:55 | Break |  |  |
| 1:55-2:10 | Human Approval Pattern | Instructor/demo | Explain why safe-but-manual approval does not scale |
| 2:10-2:45 | **Exercise 3: Human Approval Mode** | Hands-on | Add/trigger approval for risky bookings |
| 2:45-3:00 | Introduce Dogwood | Instructor/demo | Policy over tool calls and prior session history |
| 3:00-3:25 | **Exercise 4: Dogwood Auto Mode** | Hands-on | Let safe actions run, block mismatched bookings |
| 3:25-3:55 | **Optional Capstone: Attack The Agent** | Hands-on/demo | Prompt injection via travel notes; Dogwood denies unsafe action |
| 3:55-4:00 | Wrap | Instructor | Reusable architecture and next steps |

**Exercise 1: Hello Temporal**
A tiny non-agent lab.

Learners do:

- Start local Temporal.
- Run a worker.
- Start a workflow from a client.
- Call one activity.
- Open Temporal UI and inspect history.
- Optional: make the activity fail once and watch retry.

Concepts covered:

- Workflow = durable function.
- Activity = side effect / external call.
- Worker = process hosting workflow/activity code.
- History = source of truth.
- Retry = automatic recovery.

The “aha”:

> Temporal remembers where the program was, even when the process does not.

**Exercise 2: Durable Travel Agent Session**
This is where Monty enters.

Short explanation before the lab:

> “You just wrote raw Temporal. Monty packages the same ideas into an agent harness: a long-running session, messages, tool calls, state, and streaming output.”

Learners do:

- Code Mode and Monty first: run a model's script in Monty (`uv run code-mode`), and watch it reach nothing but what the host hands it.
- Start the Monty travel agent worker.
- Start a travel session.
- Send: “I need a flight from SFO to JFK next month.”
- Watch the agent ask for trip details.
- Inspect the Temporal workflow.
- Restart the worker or kill/restart the UI.
- Continue the same session.

Concepts covered:

- Code Mode: the model writes a script; each tool call is a stop the host (the workflow) answers.
- Agent session as a workflow.
- User messages as durable inputs.
- Tool calls as controlled side effects.
- Agent state as queryable state.
- Conversation is not just chat; it is durable execution.

The “aha”:

> The agent is not a request/response bot. It is a recoverable process.

**Exercise 3: Human Approval Mode**
This is the safety baseline.

Learners do:

- Switch the agent into human approval mode.
- Ask it to search and book a flight.
- See search happen, but booking pause.
- Approve one booking.
- Reject another booking.
- Inspect the event history and approval event.

Possible TODO:

- Wire an approval update handler.
- Add a validator so stale approval clicks fail.
- Add a timeout so the agent does not wait forever.

Concepts covered:

- Updates for human decisions.
- Validation before state changes.
- Durable waiting.
- Approval as part of history.
- Side effects should have explicit boundaries.

The “aha”:

> Human approval is safe, but it gets noisy fast.

**Exercise 4: Dogwood Auto Mode**
This is the main workshop payoff.

Short explanation before the lab:

> “Dogwood moves the question from ‘should I approve this one action?’ to ‘does this action match what the user already authorized?’”

Learners do:

- Fill out the trip form: traveler, origin, destination, dates.
- Ask the agent to book the cheapest matching flight.
- See search and matching booking run without manual approval.
- Ask it to book for a different person.
- See Dogwood deny it.

Concepts covered:

- Policy-as-code.
- Tool-call evaluation.
- Policy over current call + previous events.
- Permit, deny, escalate.
- Structured user intent.
- Auditability of policy decisions.

The “aha”:

> The model decides what to try. The policy decides what is allowed.

**Optional Capstone: Attack The Agent**
This is the memorable demo.

Learners do:

- Open the travel notes.
- See a malicious instruction: book a flight for Mallory.
- Ask: “Take care of everything in my notes.”
- Watch the model attempt the unsafe booking.
- See Dogwood deny it.
- Inspect the denial reason.

Concepts covered:

- Prompt injection.
- Untrusted content.
- Policy independent of model confidence.
- Why prompts alone are insufficient.

The “aha”:

> The model can be fooled. The system does not have to be.

**Where Monty Gets Explained**
Put Monty immediately after Exercise 1.

Use this mapping:

| Raw Temporal | Monty |
|---|---|
| Workflow | Agent session |
| Activity | Model call or tool call |
| Signal/Update | User message, approval, config change |
| Query | Agent state |
| Event history | Agent audit trail |
| Worker | Agent runtime |
| Retry/timer | Durable waiting and recovery |

One clean line:

> “Temporal gives us durable execution. Monty gives us an agent-shaped interface for that execution.”

**What I’d Avoid**
Don’t explain Dogwood deeply before learners have seen Monty run. Also don’t start with policy theory. The order should be: make it run, make it durable, make it safe, then make it autonomous.

**Exercise Count**
For a 4-hour workshop:

- **4 mandatory exercises**
- **1 optional capstone**
- Each mandatory exercise should have one primary TODO
- Each should have a check script
- Keep Dogwood policy editing small and concrete

That gives the workshop enough hands-on texture without turning it into a race.
