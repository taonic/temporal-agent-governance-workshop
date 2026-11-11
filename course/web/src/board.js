// The Trip board (Essentials): the actions it can take, and what it shows, from the state
// essentials/board.py reports (through the sandbox poll). Plain functions, so the page, the
// content build and the runner share one list of actions, and the view is testable.

// The board's actions (essentials/board.py ACTIONS, the same list), each a fixed command the
// runner runs in the sandbox.
export const BOARD_ACTIONS = ["setup", "reset", "start-trip", "pull-plug", "start-worker", "flaky", "ship-fix", "approve", "reject"];

// The world checks a module can name (check.world): essentials/checks.py CHECKS, the same list.
export const WORLD_CHECKS = ["trip-completed", "fix-finished", "blip-ridden-out", "waited-for-shift", "plug-survived", "hold-kept", "approval-kept", "undone"];

// The trip's five steps, as the board says them: to do, doing, done.
export const STEPS = [
  { id: "find_flight", todo: "Find a flight", doing: "Finding a flight", done: "Found a flight", system: "airline" },
  { id: "book_flight", todo: "Book the flight", doing: "Booking the flight", done: "Booked the flight", system: "airline" },
  { id: "book_hotel", todo: "Book the hotel", doing: "Booking the hotel", done: "Booked the hotel", system: "hotel" },
  { id: "charge_card", todo: "Charge the card", doing: "Charging the card", done: "Charged the card", system: "card", failed: "The card was declined" },
  { id: "send_confirmation", todo: "Send the confirmation", doing: "Sending the confirmation", done: "Sent the confirmation", system: "email" },
];
// The steps some trips add (E6's hold, E7's approval), and those that undo a booking (E8).
const MORE = [
  { id: "hold_seat", todo: "Hold the seat", doing: "Holding the seat", done: "Held the seat for three days", system: "airline" },
  { id: "wait_hold", todo: "Wait three days for the traveler", doing: "Waiting three days for the traveler", done: "Waited the three days", system: "" },
  { id: "approval", todo: "Get the manager's OK", doing: "Waiting for the manager's OK", done: "The manager approved it", rejected: "The manager said no", system: "" },
  { id: "cancel_hotel", todo: "Cancel the hotel", doing: "Cancelling the hotel", done: "Cancelled the hotel", system: "hotel" },
  { id: "cancel_flight", todo: "Cancel the flight", doing: "Cancelling the flight", done: "Cancelled the flight", system: "airline" },
];
const STEP = new Map([...STEPS, ...MORE].map((s) => [s.id, s]));
// How the board says E6's wait: honest about the speed-up.
export const SPED_UP = "three days, sped up to 30 seconds for this demo";

// The outside world's four parts, and what lands in each. Searching for a flight books nothing.
export const SYSTEMS = [
  { id: "airline", name: "Airline", icon: "✈️" },
  { id: "hotel", name: "Hotel", icon: "🏨" },
  { id: "card", name: "Card network", icon: "💳" },
  { id: "email", name: "Email", icon: "✉️" },
];
const BOOKS = new Set(["book_flight", "book_hotel", "charge_card", "send_confirmation"]);
const SHOWN = new Set([...BOOKS, "hold_seat", "cancel_hotel", "cancel_flight"]);
const CANCELS = { cancel_hotel: "book_hotel", cancel_flight: "book_flight" };
const TWICE = ["", "once", "twice", "three times"];

// One step of the Temporal trip, as its logbook says it. `now`: the time on the board's clock,
// for the hold's countdown.
function stepView(found, now) {
  const step = STEP.get(found.id) ?? { todo: found.id, doing: found.id, done: found.label ?? found.id };
  const base = { id: found.id, kind: found.kind ?? "activity", detail: "" };
  if (found.state === "done") {
    const retried = (found.attempts ?? 1) > 1;
    return { ...base, state: "done", text: step.done, detail: found.kind === "timer" ? `Three days (${SPED_UP.split(", ")[1]})` : retried ? `Got through on attempt ${found.attempts}` : "" };
  }
  if (found.state === "failed") {
    const text = step.failed ?? `Couldn't ${step.todo.toLowerCase()}`;
    return { ...base, state: "failed", text, detail: found.error && found.error !== text ? found.error : "" };
  }
  if (found.state === "rejected") return { ...base, state: "rejected", text: step.rejected ?? step.todo, detail: "" };
  if (found.state === "active") {
    if (found.kind === "timer") {
      const left = Math.max(0, Math.ceil((found.fires_at ?? now) - now));
      return { ...base, state: "active", text: step.doing, left, detail: left ? `${left}s left of the ${SPED_UP}` : "The three days are up" };
    }
    if (found.kind === "approval") return { ...base, state: "asking", text: step.doing, detail: "You're the manager: Approve or Reject, on the board" };
    const retrying = (found.attempt ?? 1) > 1;
    // A coordinator who stopped mid-step (the plug pulled) shows as a timeout: said plainly, it's
    // the next one doing the step the last one didn't finish.
    const unfinished = retrying && /timeout/i.test(found.error ?? "");
    const why = unfinished ? "the last coordinator stopped in the middle of it, so the next one does it again" : found.error;
    return { ...base, state: retrying ? "retrying" : "active", unfinished, text: step.doing, detail: retrying ? `Attempt ${found.attempt}${why ? `: ${why}` : ""}` : "" };
  }
  return { ...base, state: "todo", text: step.todo };
}

// The Temporal trip: its logbook (each step done, doing or to do, and any undoing) and one line on
// where it is.
function temporalView(trip, coordinator, now) {
  const t = trip.temporal ?? { status: "unknown", steps: [] };
  const raw = t.steps?.length ? t.steps : STEPS.map((s) => ({ id: s.id, state: "waiting" }));
  const steps = raw.map((s) => stepView(s, now));
  const undo = (t.undo ?? []).map((s) => stepView(s, now));
  const all = [...steps, ...undo];
  const active = all.find((s) => ["active", "retrying"].includes(s.state) && s.kind === "activity");
  const timer = steps.find((s) => s.kind === "timer" && s.state === "active");
  const asking = steps.find((s) => s.state === "asking");
  const answered = steps.find((s) => s.kind === "approval" && s.state === "done");
  const undoing = undo.length > 0;
  let status;
  if (t.status === "completed" && steps.some((s) => s.state === "rejected")) status = { tone: "quiet", text: "Not approved, so nothing was booked." };
  else if (t.status === "completed") status = { tone: "good", text: "Booked. Every step done, each one once." };
  else if (t.status === "failed" && undoing && undo.every((s) => s.state === "done")) {
    status = { tone: "good", text: "Card declined, and undone cleanly: the hotel was cancelled, then the flight. Nothing is left half-booked." };
  } else if (t.status === "terminated") status = { tone: "quiet", text: "Stopped: the board started over." };
  else if (t.status !== "running") status = { tone: "quiet", text: t.status === "unknown" ? "Looking for it in Temporal…" : `Ended: ${t.status}` };
  else if (timer && !coordinator) {
    status = { tone: "wait", text: timer.left ? `Waiting in the safe. The clock keeps running in Temporal: ${timer.left}s left.` : "The three days are up: it carries on as soon as a coordinator is back." };
  } else if (timer) status = { tone: "wait", text: `Holding the seat: ${timer.left}s left of the ${SPED_UP}.` };
  else if (asking) status = { tone: "wait", text: coordinator ? "Waiting for the manager's answer. That's you." : "Waiting in the safe for the manager's answer. That's you." };
  else if (!coordinator && answered && !active) status = { tone: "wait", text: "Approved. Your answer is in the logbook, waiting for a coordinator to act on it." };
  else if (!coordinator) status = { tone: "wait", text: active ? `Waiting in the safe: ${active.text.toLowerCase()} carries on when a coordinator is back.` : "Waiting in the safe for a coordinator. Nothing is lost." };
  else if (undoing) status = { tone: "busy", text: "Card declined: undoing what was booked, newest first…" };
  else if (active?.unfinished) status = { tone: "busy", text: `Carrying on from “${STEP.get(active.id).todo.toLowerCase()}”, the step the last coordinator didn't finish.` };
  else if (active?.state === "retrying") status = { tone: "wait", text: `Paused at “${STEP.get(active.id).todo.toLowerCase()}”: trying again, waiting a little longer each time.` };
  else status = { tone: "busy", text: active ? `${active.text}…` : "Recorded: a coordinator is picking it up…" };
  return { steps, undo, status, done: steps.filter((s) => s.state === "done").length, asking: Boolean(asking) };
}

// The plain twin's trip: what it got done, and what became of it.
function plainView(trip, running) {
  const p = trip.plain ?? { status: "waiting", done: [], step: null, starts: 0, message: "" };
  const done = new Set(p.done ?? []);
  const steps = STEPS.map((step) => {
    // Where it stopped: still at it, or (crashed, or killed mid-step) lost there.
    const stoppedHere = p.step === step.id && (p.status === "failed" || (p.status === "running" && !running));
    const state = done.has(step.id) ? "done" : stoppedHere ? "lost" : p.status === "running" && p.step === step.id ? "active" : "todo";
    return { id: step.id, state, text: state === "done" ? step.done : state === "active" ? step.doing : step.todo, detail: "" };
  });
  let status;
  if (p.status === "dropped") status = { tone: "bad", text: "Request lost: nobody was there to take it." };
  else if (p.status === "failed") status = { tone: "bad", text: p.message || "Failed: the trip is lost." };
  else if (p.status === "completed") status = { tone: p.starts > 1 ? "bad" : "good", text: p.starts > 1 ? "Booked, after starting over from the top." : "Booked." };
  else if (p.status === "running" && !running) status = { tone: "bad", text: "Stopped mid-trip. Everything it knew about this trip was in memory, and it's gone." };
  else if (p.status === "running") status = { tone: "busy", text: p.starts > 1 ? "Started again after the restart, from the top…" : "In progress…" };
  else status = { tone: "quiet", text: "Waiting to start…" };
  return { steps, status, starts: p.starts ?? 0 };
}

// The outside world: each part's bookings, latest last, with any made more than once for the
// same trip flagged; and the doubles, said plainly ("Ana's flight was booked twice").
function worldView(entries, trips) {
  const traveler = new Map(trips.map((t) => [t.trip_id, t.traveler]));
  const bookings = entries.filter((e) => SHOWN.has(e.step));
  const count = new Map();
  for (const e of bookings) if (BOOKS.has(e.step)) count.set(`${e.who}:${e.trip}:${e.step}`, (count.get(`${e.who}:${e.trip}:${e.step}`) ?? 0) + 1);
  // A booking a later entry cancelled (E8's undoing).
  const cancelled = new Set(bookings.filter((e) => CANCELS[e.step]).map((e) => `${e.who}:${e.trip}:${CANCELS[e.step]}`));
  const systems = SYSTEMS.map((system) => ({
    ...system,
    entries: bookings
      .filter((e) => e.system === system.id)
      .map((e, i, all) => {
        const times = count.get(`${e.who}:${e.trip}:${e.step}`);
        // The second (and later) of a double.
        const repeat = all.slice(0, i).some((o) => o.who === e.who && o.trip === e.trip && o.step === e.step);
        return {
          key: `${e.key}-${i}`,
          who: e.who,
          traveler: traveler.get(e.trip) ?? e.traveler,
          what: e.what,
          repeat,
          times,
          cancel: Boolean(CANCELS[e.step]),
          cancelled: cancelled.has(`${e.who}:${e.trip}:${e.step}`),
        };
      }),
  }));
  const doubles = [...count]
    .filter(([, n]) => n > 1)
    .map(([key, n]) => {
      const [who, trip, step] = key.split(":");
      const what = { book_flight: "flight was booked", book_hotel: "hotel was booked", charge_card: "card was charged", send_confirmation: "confirmation was sent" }[step];
      return { who, text: `${traveler.get(trip) ?? "A traveler"}'s ${what} ${TWICE[n] ?? `${n} times`}` };
    });
  return { systems, doubles, empty: bookings.length === 0 };
}

// This module's world check, as the board saw it: its name, and whether it has passed.
function checkView(state) {
  return { name: state.check?.name ?? null, passed: Boolean(state.check?.passed), module: state.module };
}

// Everything the board shows, from the state essentials/board.py reports. null: no state yet.
// `now`: the board's clock (seconds, as the state's `at`), for the hold's countdown between polls.
export function boardView(state, now = state?.at ?? Date.now() / 1000) {
  if (!state) return null;
  const trips = state.trips ?? [];
  return {
    module: state.module,
    twin: Boolean(state.twin),
    coordinator: Boolean(state.worker),
    plainRunning: Boolean(state.plain),
    flaky: Boolean(state.flaky),
    flakyFor: state.flakyFor ?? 0,
    mistake: Boolean(state.mistake),
    declined: Boolean(state.declined),
    check: checkView(state),
    trips: trips
      .slice()
      .reverse()
      .map((t) => ({
        id: t.trip_id,
        workflowId: t.workflow_id,
        title: `${t.traveler}'s trip`,
        route: `${t.origin} → ${t.destination}`,
        temporal: temporalView(t, Boolean(state.worker), now),
        plain: t.twin ? plainView(t, Boolean(state.plain)) : null,
      })),
    world: worldView(state.world ?? [], trips),
  };
}

// The actions a module's text uses (its sections' #board/… buttons), for the board to offer too.
export function actionsIn(html) {
  return [...new Set([...String(html).matchAll(/data-board-action="([a-z-]+)"/g)].map((m) => m[1]))];
}
