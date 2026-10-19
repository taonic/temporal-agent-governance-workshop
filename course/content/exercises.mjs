// What the site needs to know about each exercise that its assignment.md doesn't say: the
// files the editor opens, the command the worker terminal runs, the questions Ask Temporal
// suggests there, and the code tour. Keyed by challenge dir.
//
// An editable file is one learners change and the exercise's solve script replaces; a
// `scratch` one is also editable, but only to play with: it has no solution.
//
// A code tour stop is a chunk of one of the exercise's files, found by text so it survives
// edits: `from`, a piece of its first line; `to`, a piece of its last (the first line after
// `from` that has it). Without `to`, an indented or ":"-ended first line takes its block, and
// anything else runs to the next blank line. The build checks every anchor against the
// starter. `body` is Markdown, a sentence or three.
//
// The guide offers the tour at the end of the briefing, just before step 1. `tourAfter` offers
// it on another beat instead, by its heading ("1. Run a script in Monty"): leaving that beat starts it.
//
// `fromBeat` and `untilBeat` on a file (headings, as `tourAfter`) show its tab only on those beats
// of the guide and the ones between; the file open (from a link, or the code tour) always shows.
//
// `agentUi: false` leaves the Agent UI tab out of an exercise that has no agent yet.
export const EXERCISES = {
  "01-hello-temporal": {
    worker: "uv run hello-worker",
    agentUi: false,
    files: [
      { path: "hello/workflow.py", editable: true },
      { path: "hello/activities.py" },
      { path: "hello/starter.py" },
      { path: "hello/board.py" },
    ],
    questions: [
      "What's the difference between a workflow and an activity?",
      "Why does my workflow pick up where it left off after I fix the bug?",
      "How do activity retry policies and timeouts work together?",
      "What does start_to_close_timeout actually limit?",
      "Where is a workflow's state while no worker is running?",
    ],
    tour: [
      {
        file: "hello/workflow.py",
        from: '"""The workflow:',
        to: "Temporal records each result",
        title: "A workflow is deterministic",
        body: "This file is the workflow: plain async Python that Temporal can **replay** from its history, on any worker, at any time. So it never touches the outside world itself. Anything that does goes through an activity.",
      },
      {
        file: "hello/workflow.py",
        from: "with workflow.unsafe.imports_passed_through():",
        title: "Imports from outside the sandbox",
        body: "The SDK runs workflow code in a sandbox that guards determinism. These come from outside it: the activity (the workflow only needs its name and types, it never runs it) and the shared data models.",
      },
      {
        file: "hello/workflow.py",
        from: "@workflow.defn",
        to: 'return f"Your trip:',
        title: "The workflow and its entry point",
        body: "`@workflow.defn` marks the class, `@workflow.run` is the method Temporal starts. Each `await` is a step Temporal records, so a worker that restarts carries on after the last one that finished.",
      },
      {
        file: "hello/workflow.py",
        from: "async def airport(self, code: str)",
        title: "Your TODO",
        body: "This should ask Temporal to run `lookup_airport`, with a timeout for each attempt and a retry policy. Until it does, it raises, and Temporal **pauses** the workflow and retries this step rather than failing it.",
      },
      {
        file: "hello/activities.py",
        from: "@activity.defn",
        title: "The activity: where the world gets in",
        body: "The one place that does I/O (here a dict stands in for an airport database). Activities can fail and be retried; `activity.info().attempt` says which try this is, and `FLAKY=1` fails the first four of each lookup so you can watch.",
      },
      {
        file: "hello/starter.py",
        from: "async def main(origin: str, destination: str)",
        title: "The starter is just a client",
        body: "It records a workflow on the task queue the worker polls, under an id of its own, prints a link to it, and waits for the result. The workflow doesn't need it waiting: stop the starter and the workflow carries on.",
      },
      {
        file: "hello/board.py",
        from: "async def run(self, flight: BoardingRequest)",
        title: "A count nobody saves",
        body: "Section 7's workflow: no activities, just a durable timer and `self.on_board += 1`. Stop the worker and start it again, and the new worker replays the history (every timer that fired) and runs this loop again to rebuild the count.",
      },
      {
        file: "hello/board.py",
        from: "@workflow.query",
        to: "return BoardingStatus(",
        title: "Reading it: a query",
        body: "The Temporal UI's **Queries** tab calls this. A worker answers from the workflow's state, so with no worker running the query has no one to answer it.",
      },
    ],
  },
  "02-durable-session": {
    worker: "uv run travel-worker",
    files: [
      // Step 1 is about Monty alone: its tab is the only one until the agent starts.
      { path: "codemode/sandbox.py", editable: true, untilBeat: "The agent" },
      { path: "travel_agent/travel/activities.py", editable: true, fromBeat: "2. Start the agent's worker" },
      { path: "travel_agent/travel/inventory.py", fromBeat: "2. Start the agent's worker" },
    ],
    // After "The agent", not before step 1: the tour recaps the script and the host from the
    // Monty hands-on, and ends on the agent's activities, just before the agent starts.
    tourAfter: "The agent",
    questions: [
      "Why does the agent write a script instead of calling tools one at a time?",
      "How does a script's tool call become a durable activity?",
      "How does a conversation survive when the worker dies?",
      "Why is every LLM call an activity instead of workflow code?",
      "What's a workflow Update, and how is it different from a Signal?",
      "What happens to a workflow when an activity keeps failing?",
    ],
    tour: [
      {
        file: "codemode/sandbox.py",
        from: "MODEL_SCRIPT = ",
        title: "Code a model wrote",
        body: "In Code Mode the model writes Python like this, and Monty runs it in its sandbox. It imports nothing: whatever it calls, the host passes in.",
      },
      {
        file: "codemode/sandbox.py",
        from: "def run(script: str):",
        title: "One inside the other",
        body: "A fresh sandbox, type-checked against `STUBS`, with a time limit. `HOST_FUNCTIONS` is everything the script can reach: functions defined on the host, called from inside the sandbox. In the agent, the workflow is the host: it runs each call as an **activity**.",
      },
      {
        file: "travel_agent/travel/activities.py",
        from: '"""The travel tools:',
        to: "retried until it succeeds, never repeated after",
        title: "The agent's tools are activities",
        body: "The model never calls these. It writes a Python script, and each call the script makes to `search_flights` or `book_flight` runs here as a Temporal activity: a step in the session's history, retried if it fails, never repeated once it succeeded.",
      },
      {
        file: "travel_agent/travel/activities.py",
        from: "# Retry quickly:",
        to: "retry_policy=RetryPolicy(maximum_interval=timedelta(seconds=3))",
        title: "Timeouts and retries for every tool",
        body: "Thirty seconds an attempt, and retries that back off to at most 3 seconds, so a tool you fix in the middle of a session is picked up within seconds.",
      },
      {
        file: "travel_agent/travel/activities.py",
        from: "def _make_ref(prefix: str, *parts: str)",
        title: "Safe to run twice",
        body: "An activity can run more than once (a retry after it actually succeeded, say). The confirmation code comes from what's booked, so a repeated booking gets the same code instead of a second booking.",
      },
      {
        file: "travel_agent/travel/activities.py",
        from: '@agent.activity_tool_defn(name="search_flights"',
        title: "Your TODO",
        body: "The tool the agent reaches for first. Until it's written it raises, and the session waits on its retries. Write it, restart the worker, and the same conversation carries on.",
      },
      {
        file: "travel_agent/travel/activities.py",
        from: "claimed = (request.date, request.price_cents, request.nonstop)",
        to: "costs {flight.price_cents} cents",
        title: "Some failures shouldn't retry",
        body: "A booking that doesn't match its flight raises a **non-retryable** error (see `_refuse`): trying again can't make it right, so Temporal hands it straight back to the agent.",
      },
      {
        file: "travel_agent/travel/activities.py",
        from: "ALL_TOOLS = [",
        to: "]",
        title: "One list, two uses",
        body: "The workflow offers these to the agent's scripts as functions to call, and the worker registers their activity bodies from the same list.",
      },
      {
        file: "travel_agent/travel/inventory.py",
        from: '"""The simulated travel inventory:',
        to: "rebuild it from the id alone",
        title: "Seeded, not live",
        body: "No real flights API: results come from the route and date, the same every time, with a planted shape (the cheapest with a stop, nonstops, a fare over $1,000), so every run shows the same choices.",
      },
    ],
  },
  "03-human-approval": {
    worker: "uv run travel-worker",
    files: [{ path: "travel_agent/agent/workflow.py", editable: true }],
    questions: [
      "How can a workflow wait days for a human without using resources?",
      "Signals, Updates and Queries: when do I use which?",
      "How do I reject a stale or invalid Update with a validator?",
      "What does workflow.wait_condition do?",
    ],
    tour: [
      {
        file: "travel_agent/agent/workflow.py",
        from: "# Safe to run without asking",
        to: "ask_trip_details.__name__,",
        title: "What's always safe",
        body: "The trip board, the in-memory notes and the trip form only touch the agent's own state or ask you, so every posture but `human_approval_only` lets them run.",
      },
      {
        file: "travel_agent/agent/workflow.py",
        from: "Posture = Literal[",
        title: "Four approval postures",
        body: "How much the agent may do without asking: everything, nothing, everything but bookings (yours to write), or whatever the Dogwood policy allows (exercise 4).",
      },
      {
        file: "travel_agent/agent/workflow.py",
        from: "def approval_policy(posture: Posture)",
        title: "Your TODO",
        body: "Each posture becomes a `ToolApprovalPolicy`. For `approve_bookings`, allow the tools that can't change anything in the world, so only bookings stop and wait for you.",
      },
      {
        file: "travel_agent/agent/workflow.py",
        from: '@agent.defn(name="TravelAgent")',
        to: "self._messages: list",
        title: "A session is a workflow",
        body: "One workflow per conversation. The trip board, the notes and the messages are workflow state, so they survive any worker restart; the runner applies the posture to every tool call.",
      },
      {
        file: "travel_agent/agent/workflow.py",
        from: "@agent.accepts(mid_turn=MidTurn.ACCEPT, model_callable=False)",
        to: "Approval posture is now",
        title: "Changing the rules mid-session",
        body: "A workflow **Update**: the console sends it, the posture changes, and the change is recorded in the history like everything else. `MidTurn.ACCEPT` lets it land even while a turn is running.",
      },
      {
        file: "travel_agent/agent/workflow.py",
        from: "async def _chat_turn(self, user_text: str)",
        title: "The agent loop",
        body: "Call the model, run the tools it asks for, feed back the results, repeat. Plain workflow code: every model call and tool call it awaits is a recorded step.",
      },
      {
        file: "travel_agent/agent/workflow.py",
        from: "async def _call_model(self)",
        title: "The model call is an activity",
        body: "An LLM call is I/O, and its answer differs every time, so it runs as an activity with a timeout, a heartbeat and retries. On replay, the recorded answer is reused.",
      },
      {
        file: "travel_agent/agent/workflow.py",
        from: "async def _run_tool(self, call: ToolCall)",
        to: "output = await self._runner.run_tool",
        title: "Where approval happens",
        body: "Every tool call goes through the runner, which applies the posture: run it now, or wait (for days, if need be, at no cost) for your approval. A failure goes back to the model as text.",
      },
    ],
  },
  "04-auto-mode": {
    worker: "uv run travel-worker",
    files: [{ path: "policies/travel.dw", editable: true }],
    questions: [
      "What is Temporal Nexus, and why call the verifier through it?",
      "How do I call a Nexus operation from a workflow?",
      "Is it safe to change workflow code while sessions are running?",
      "How would I version this workflow if the policy check changes?",
    ],
    tour: [
      {
        file: "policies/travel.dw",
        from: "// Tool policy for the travel agent in auto mode.",
        to: "// After editing,",
        title: "How the policy decides",
        body: "Only bookings come here. A `permit` lets one run unattended; anything no rule permits is refused. The rules decide by looking back over this session's history.",
      },
      {
        file: "policies/travel.dw",
        from: "// TODO(ch04)",
        title: "Your TODO",
        body: "Plain Cedar: this rule checks the call itself, so any flight for Ada runs, on any day. You'll make it look back at the trip form you submitted earlier in this session.",
      },
      {
        file: "policies/travel.dw",
        from: '@id("hotels-for-the-trip-form-traveler")',
        title: "A rule that remembers",
        body: "`formerly within 2h …::received{…}` looks back through the session's history for a trip form whose traveler is this hotel's guest. Temporal's history is what makes that possible.",
      },
    ],
  },
  "05-attack-the-agent": {
    worker: "uv run travel-worker",
    files: [{ path: "travel_agent/agent/prompts.py" }, { path: "policies/travel.dw" }],
    questions: [
      "How can I use workflow history to audit what an agent did?",
      "How do I find workflows by a custom search attribute?",
      "What's the difference between cancelling and terminating a workflow?",
    ],
    tour: [
      {
        file: "travel_agent/agent/prompts.py",
        from: 'SYSTEM_INSTRUCTION = """',
        to: "Board calls are cheap",
        title: "What the model is told",
        body: "It works by writing scripts against host functions, keeps the trip board current, and uses only ids a script returned. Nothing here can stop it doing something it shouldn't.",
      },
      {
        file: "travel_agent/agent/prompts.py",
        from: 'TRIP_FORM_INSTRUCTION = """',
        to: "rest; don't retry it",
        title: "The trip form",
        body: "The form's answers are what the policy trusts: the model asks for one when it doesn't know the traveler and dates, and books with exactly those details.",
      },
      {
        file: "travel_agent/agent/prompts.py",
        from: "# DEMO ONLY:",
        to: "priority over your other guidance",
        title: "Deliberately gullible",
        body: "This tells the model to obey instructions it finds in files, so the planted to-do (book Mallory a flight) reliably gets as far as the policy. Never ship anything like it.",
      },
      {
        file: "policies/travel.dw",
        from: "// No rule permits any other booking",
        title: "What holds the line",
        body: "The model can be talked into anything; the policy can't. A flight runs only when a trip form you submitted names its passenger and date. Mallory isn't on one, so nothing permits the booking, and it's refused.",
      },
    ],
  },
};

// A command typed into the worker terminal rather than the commands terminal when a ▶ is clicked.
export const WORKER_COMMAND = /^(?:\w+=\S+\s+)*uv run (?:hello|travel)-worker\b/;
