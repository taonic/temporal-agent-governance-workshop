---
id: A8
title: Approve everything
teaser: Make every call the agent makes wait for you, and count the approvals.
learn: "Human approval: a tool call that waits, durably, for a person to say yes."
minutes: 8
xp: 10
tier: 3
requires:
  - A7
check:
  kind: pending
files:
  - path: travel_agent/agent/workflow.py
    editable: true
questions:
  - How can a workflow wait days for a human without using resources?
  - "Signals, Updates and Queries: when do I use which?"
  - How do I reject a stale or invalid Update with a validator?
  - What does workflow.wait_condition do?
tour:
  - file: travel_agent/agent/workflow.py
    from: "# Safe to run without asking"
    to: ask_concierge.__name__,
    title: What's always safe
    body: The trip board, the in-memory notes, the trip form and the concierge's answers only touch the agent's own state, ask you, or ask a question, so every posture but `human_approval_only` lets them run.
  - file: travel_agent/agent/workflow.py
    from: Posture = Literal[
    title: Four approval postures
    body: "How much the agent may do without asking: everything, nothing, everything but bookings (yours to write), or whatever your policy allows (exercise 5)."
  - file: travel_agent/agent/workflow.py
    from: "def approval_policy(posture: Posture)"
    title: Your TODO
    body: Each posture becomes a `ToolApprovalPolicy`. For `approve_bookings`, allow the tools that can't change anything in the world, so only bookings stop and wait for you.
  - file: travel_agent/agent/workflow.py
    from: '@agent.defn(name="TravelAgent")'
    to: "self._messages: list"
    title: A session is a workflow
    body: One workflow per conversation. The trip board, the notes and the messages are workflow state, so they survive any worker restart; the runner applies the posture to every tool call.
  - file: travel_agent/agent/workflow.py
    from: "@agent.accepts(mid_turn=MidTurn.ACCEPT, model_callable=False)"
    to: Approval posture is now
    title: Changing the rules mid-session
    body: "A workflow **Update**: the console sends it, the posture changes, and the change is recorded in the history like everything else. `MidTurn.ACCEPT` lets it land even while a turn is running."
  - file: travel_agent/agent/workflow.py
    from: "async def _chat_turn(self, user_text: str)"
    title: The agent loop
    body: "Call the model, run the tools it asks for, feed back the results, repeat. Plain workflow code: every model call and tool call it awaits is a recorded step."
  - file: travel_agent/agent/workflow.py
    from: async def _call_model(self)
    title: The model call is an activity
    body: An LLM call is I/O, and its answer differs every time, so it runs as an activity with a timeout, a heartbeat and retries. On replay, the recorded answer is reused.
  - file: travel_agent/agent/workflow.py
    from: "async def _run_tool(self, call: ToolCall)"
    to: output = await self._runner.run_tool
    title: Where approval happens
    body: "Every tool call goes through the runner, which applies the posture: run it now, or wait (for days, if need be, at no cost) for your approval. A failure goes back to the model as text."
---

An agent that books travel on its own judgment needs a human in the loop. That sounds simple until you build it. The human might answer in five seconds or five hours, and your servers might be redeployed in between. The approve button might be clicked twice, or after the agent has moved on.

The harness already handles the hard parts:

- An approval is a Temporal **Update** (`tool_approval`). Unlike a Signal, it returns an answer, so the clicker learns whether it counted.
- A **validator** runs before anything is written to history, and rejects a decision for a call that isn't pending, or was already decided.
- The agent **waits durably**: a workflow blocked on an approval costs nothing, and survives restarts.

Your job is the policy: what needs approval.

[![How human approval works. You ask the agent session, a Temporal workflow running with the approve_bookings posture. Each turn the model decides the next call, and its tool calls go through the approval gate, approval_policy(), which you write. Allowed calls (the searches, the script, the trip board) run straight away as tool calls to the travel API. A booking waits, durably, and shows you an approval card in the Agent UI. Your approve or reject is a tool_approval Update: validated, then recorded in the history, and its decision goes back to the gate.](../../../docs/architecture/ex4-approval.png)](../../../docs/architecture/ex4-approval.html)

First, see what happens when everything does.

<!-- local -->Starting here, without the modules this one builds on done? Run `./quest enter A8` first: it solves each of them you haven't, and leaves the ones you did alone. Then restart the worker.<!-- /local -->

## 1. Approve everything

Start the worker. The posture **`human_approval_only`** [allows nothing on its own](https://github.com/temporal-community/temporal-agent-harness/blob/15da54ee8e2baff0370ca245e9da1e29ba831ab8/temporal_agent_harness/harness/agent_protocol/agent_interface.py#L600-L620): every call the agent makes waits for you. Start a new session with it<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="human_approval_only" title="Open the Travel agent's start form in the Agent UI, with human_approval_only chosen">New session ▸</button>
-->, and ask:

> Book the cheapest flight from SFO to JFK on 2026-11-01 for Ada Lovelace.

Count the approvals. The agent's script needs approving. So does the search inside it, then the booking, and then each note it writes to the trip board. If the agent asks for the trip form, that needs approving too. It's safe, but it's not usable. Nobody reads the fifth "approve search_flights?" card.
