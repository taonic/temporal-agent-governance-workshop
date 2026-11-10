// Once a minute: the sandboxes as Daytona lists them. A running sandbox counts a minute of its
// learner's sandbox time; a change of state is an event (started, stopped, gone); and a learner
// over their daily allowance has their sandbox stopped. The model-call counts are written too.
//
// Daytona stops an idle sandbox on its own (SANDBOX_AUTO_STOP_MINUTES), and that idle time
// counts: Daytona bills for it. While the runner itself is stopped (Fly stops it when nobody's
// using the site), nothing is counted.
import { DEFAULT_ALLOWANCE_MINUTES } from "./accounts.mjs";

const RUNNING = new Set(["started", "starting"]);

export function createSweep({ manager, accounts, activity, log = () => {}, enabled = () => true }) {
  let last = null; // learner -> state, from the last sweep (null before the first)

  // The allowance that applies to a learner: their cohort's, else the default.
  function limitFor(userId) {
    const user = accounts.user(userId);
    const cohort = user ? accounts.accessFor(user.email).cohort : null;
    return cohort?.allowance_minutes ?? DEFAULT_ALLOWANCE_MINUTES;
  }

  async function tick() {
    activity.flushModelCalls();
    if (!enabled()) return;
    let sandboxes;
    try {
      sandboxes = await manager.listAll();
    } catch (err) {
      log(`sweep: listing sandboxes failed: ${err.message}`);
      return;
    }
    const now = new Map();
    for (const s of sandboxes) if (s.learner) now.set(s.learner, s.state);
    for (const [learner, state] of now) {
      const running = RUNNING.has(state);
      const was = last?.get(learner);
      if (running) activity.countSandboxMinute(learner);
      if (last && running && !RUNNING.has(was ?? "")) activity.record(learner, "sandbox_started", null, { state });
      if (last && !running && was && RUNNING.has(was)) activity.record(learner, "sandbox_stopped", null, { state });
      if (running) {
        const allowance = activity.allowance(learner, limitFor(learner));
        if (allowance.remainingMinutes <= 0) {
          log(`sweep: learner ${learner} is out of sandbox time; stopping their sandbox`);
          activity.record(learner, "allowance_reached", null, { usedMinutes: allowance.usedMinutes, limitMinutes: allowance.limitMinutes });
          await manager.stop(learner).catch((err) => log(`sweep: stopping ${learner}'s sandbox failed: ${err.message}`));
        }
      }
    }
    if (last) for (const [learner, state] of last) if (!now.has(learner)) activity.record(learner, "sandbox_gone", null, { was: state });
    last = now;
    activity.pruneSandboxMinutes();
  }

  return { tick, limitFor };
}
