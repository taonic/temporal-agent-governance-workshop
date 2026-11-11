// The Trip board's view (web/src/board.js): from the state essentials/board.py reports to what
// each panel says.
import assert from "node:assert/strict";
import { test } from "node:test";

import { actionsIn, boardView } from "../web/src/board.js";

const steps = (states) =>
  ["find_flight", "book_flight", "book_hotel", "charge_card", "send_confirmation"].map((id, i) => ({ id, state: "waiting", ...(states[i] ?? {}) }));
const trip = (temporal, plain = null) => ({
  trip_id: "trip-1",
  traveler: "Ana",
  origin: "SFO",
  destination: "JFK",
  workflow_id: "trip-1-ana-1",
  twin: Boolean(plain),
  temporal,
  ...(plain ? { plain } : {}),
});
const entry = (who, step, system, key = `${who}:${step}`) => ({ who, trip: "trip-1", traveler: "Ana", step, system, key, what: `${step} done` });

test("no state yet, no board", () => {
  assert.equal(boardView(null), null);
});

test("a mistake: the Temporal trip pauses and tries again; the plain twin's trip is lost", () => {
  const view = boardView({
    worker: true,
    plain: true,
    twin: true,
    mistake: true,
    trips: [
      trip(
        { status: "running", steps: steps([{ state: "done" }, { state: "done" }, { state: "active", attempt: 3, error: "A mistake in the hotel step" }]) },
        { status: "failed", done: ["find_flight", "book_flight"], step: "book_hotel", starts: 1, message: "Crashed at the hotel step: the trip is lost" },
      ),
    ],
    world: [entry("temporal", "book_flight", "airline"), entry("plain", "book_flight", "airline")],
  });
  const [t] = view.trips;
  assert.deepEqual(t.temporal.steps.map((s) => s.state), ["done", "done", "retrying", "todo", "todo"]);
  assert.equal(t.temporal.steps[2].detail, "Attempt 3: A mistake in the hotel step");
  assert.equal(t.temporal.status.tone, "wait");
  assert.match(t.temporal.status.text, /Paused at “book the hotel”: trying again/);
  assert.equal(t.plain.status.tone, "bad");
  assert.match(t.plain.status.text, /trip is lost/);
  assert.deepEqual(t.plain.steps.map((s) => s.state), ["done", "done", "lost", "todo", "todo"], "it crashed at the hotel");
  assert.deepEqual(view.world.systems.find((s) => s.id === "airline").entries.map((e) => e.who), ["temporal", "plain"]);
  assert.deepEqual(view.world.doubles, []);
});

test("with no coordinator, the Temporal trip waits in the safe and the plain twin's is gone", () => {
  const view = boardView({
    worker: false,
    plain: false,
    twin: true,
    trips: [trip({ status: "running", steps: steps([{ state: "done" }, { state: "done" }, { state: "active", attempt: 1 }]) }, { status: "running", done: ["find_flight", "book_flight"], step: "book_hotel", starts: 1 })],
    world: [],
  });
  const [t] = view.trips;
  assert.equal(view.coordinator, false);
  assert.match(t.temporal.status.text, /^Waiting in the safe: booking the hotel carries on/);
  assert.equal(t.plain.steps[2].state, "lost");
  assert.match(t.plain.status.text, /Stopped mid-trip/);
});

test("a plain twin that started over books twice, and the board says so", () => {
  const view = boardView({
    worker: true,
    plain: true,
    twin: true,
    trips: [trip({ status: "completed", steps: steps(Array(5).fill({ state: "done" })) }, { status: "completed", done: [], starts: 2 })],
    world: [
      entry("temporal", "find_flight", "airline"),
      entry("temporal", "book_flight", "airline"),
      entry("plain", "book_flight", "airline", "plain:1"),
      entry("plain", "book_flight", "airline", "plain:2"),
    ],
  });
  const [t] = view.trips;
  assert.match(t.temporal.status.text, /each one once/);
  assert.equal(t.plain.status.tone, "bad");
  assert.deepEqual(view.world.doubles, [{ who: "plain", text: "Ana's flight was booked twice" }]);
  const airline = view.world.systems.find((s) => s.id === "airline").entries;
  assert.deepEqual(airline.map((e) => [e.who, e.repeat]), [["temporal", false], ["plain", false], ["plain", true]], "a search books nothing");
});

test("a request with nobody to take it is lost; the latest trip comes first", () => {
  const view = boardView({
    worker: false,
    twin: true,
    trips: [trip({ status: "completed", steps: [] }), { ...trip({ status: "running", steps: steps([]) }, { status: "dropped", done: [] }), trip_id: "trip-2", traveler: "Ben" }],
    world: [],
  });
  assert.deepEqual(view.trips.map((t) => t.title), ["Ben's trip", "Ana's trip"]);
  assert.match(view.trips[0].plain.status.text, /Request lost/);
  assert.match(view.trips[0].temporal.status.text, /^Waiting in the safe for a coordinator/);
  assert.equal(view.trips[1].plain, null, "a trip started without the twin has none");
});

test("a module's actions are the board buttons in its text", () => {
  const html = '<button class="board-action" data-board-action="start-trip">Start</button> … <button data-board-action="ship-fix">Fix</button> <button data-board-action="start-trip">Again</button>';
  assert.deepEqual(actionsIn(html), ["start-trip", "ship-fix"]);
});

// The later modules' trips: a hold on Temporal's clock, the manager's answer, a declined card.
const planSteps = (extra, states) => {
  const ids = ["find_flight", ...extra, "book_flight", "book_hotel", "charge_card", "send_confirmation"];
  return ids.map((id, i) => ({ id, kind: id === "wait_hold" ? "timer" : id === "approval" ? "approval" : "activity", state: "waiting", ...(states[i] ?? {}) }));
};

test("a held seat counts its three days down on Temporal's clock, coordinator or not", () => {
  const state = (worker, firesAt) => ({
    worker,
    at: 1000,
    trips: [trip({ status: "running", steps: planSteps(["hold_seat", "wait_hold"], [{ state: "done" }, { state: "done" }, { state: "active", started: 990, fires_at: firesAt }]) })],
    world: [],
  });
  const on = boardView(state(true, 1020)).trips[0].temporal;
  assert.equal(on.steps[2].left, 20);
  assert.match(on.steps[2].detail, /20s left of the three days, sped up to 30 seconds/);
  assert.match(on.status.text, /^Holding the seat: 20s left/);
  // A second later on the board's clock, between polls: one second less.
  assert.equal(boardView(state(true, 1020), 1001).trips[0].temporal.steps[2].left, 19);
  assert.match(boardView(state(false, 1020)).trips[0].temporal.status.text, /The clock keeps running in Temporal: 20s left/);
  assert.match(boardView(state(false, 995)).trips[0].temporal.status.text, /three days are up: it carries on as soon as a coordinator is back/);
});

test("a trip waiting for the manager asks; an answer given with nobody on shift is kept", () => {
  const waiting = boardView({ worker: false, trips: [trip({ status: "running", steps: planSteps(["approval"], [{ state: "done" }, { state: "active" }]) })], world: [] }).trips[0].temporal;
  assert.ok(waiting.asking);
  assert.equal(waiting.steps[1].state, "asking");
  assert.match(waiting.status.text, /Waiting in the safe for the manager's answer/);
  const answered = boardView({ worker: false, trips: [trip({ status: "running", steps: planSteps(["approval"], [{ state: "done" }, { state: "done", at: 5 }]) })], world: [] }).trips[0].temporal;
  assert.ok(!answered.asking);
  assert.match(answered.status.text, /^Approved\. Your answer is in the logbook/);
  const rejected = boardView({ worker: true, trips: [trip({ status: "completed", steps: planSteps(["approval"], [{ state: "done" }, { state: "rejected" }]) })], world: [] }).trips[0].temporal;
  assert.equal(rejected.steps[1].text, "The manager said no");
  assert.match(rejected.status.text, /^Not approved, so nothing was booked/);
});

test("a declined card: the trip undoes the hotel, then the flight, and the world shows them cancelled", () => {
  const view = boardView({
    worker: true,
    declined: true,
    trips: [
      trip({
        status: "failed",
        steps: steps([{ state: "done" }, { state: "done" }, { state: "done" }, { state: "failed", error: "The card was declined" }]),
        undo: [
          { id: "cancel_hotel", state: "done", at: 1 },
          { id: "cancel_flight", state: "done", at: 2 },
        ],
      }),
    ],
    world: [
      entry("temporal", "book_flight", "airline"),
      entry("temporal", "book_hotel", "hotel"),
      entry("temporal", "cancel_hotel", "hotel"),
      entry("temporal", "cancel_flight", "airline"),
    ],
  });
  const [t] = view.trips;
  assert.equal(t.temporal.steps[3].state, "failed");
  assert.equal(t.temporal.steps[3].text, "The card was declined");
  assert.deepEqual(t.temporal.undo.map((s) => s.text), ["Cancelled the hotel", "Cancelled the flight"]);
  assert.match(t.temporal.status.text, /undone cleanly/);
  const hotel = view.world.systems.find((s) => s.id === "hotel").entries;
  assert.deepEqual(hotel.map((e) => [e.cancel, e.cancelled]), [[false, true], [true, false]]);
  assert.deepEqual(view.world.doubles, [], "a cancellation isn't a second booking");
});

test("a step that took more than one attempt says so once it's through", () => {
  const view = boardView({ worker: true, trips: [trip({ status: "completed", steps: steps([{ state: "done", attempts: 4 }, { state: "done" }, { state: "done" }, { state: "done" }, { state: "done" }]) })], world: [] });
  assert.equal(view.trips[0].temporal.steps[0].detail, "Got through on attempt 4");
});

test("a step the last coordinator didn't finish is said plainly, not as a timeout", () => {
  const view = boardView({ worker: true, trips: [trip({ status: "running", steps: steps([{ state: "done" }, { state: "done" }, { state: "done" }, { state: "active", attempt: 2, error: "activity Heartbeat timeout" }]) })], world: [] });
  const t = view.trips[0].temporal;
  assert.doesNotMatch(t.steps[3].detail, /Heartbeat|timeout/);
  assert.match(t.steps[3].detail, /^Attempt 2: the last coordinator stopped in the middle of it/);
  assert.match(t.status.text, /^Carrying on from “charge the card”/);
});

test("the airline's bad minute counts down on the board's clock, between polls, and ends on time", () => {
  const state = { module: "E3", at: 1000, flaky: true, flakyFor: 16.4, trips: [] };
  assert.deepEqual([0, 1, 2, 3].map((s) => boardView(state, 1000 + s).flakyFor), [17, 16, 15, 14]);
  assert.equal(boardView(state, 1016.5).flaky, false);
  assert.equal(boardView({ ...state, flaky: false }, 1000).flakyFor, 0);
});
