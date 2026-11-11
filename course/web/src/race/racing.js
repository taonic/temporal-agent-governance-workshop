// The course, for a racer: their race as it stands (polled), who they are in it, and whether
// they're still waiting for the gun (the lobby covers the course until then).
import { computed, watch } from "vue";

import { navigate, resumeSandbox, store } from "../store.js";
import { live, stopRace, watchRace } from "./live.js";

watch(
  () => store.race?.slug,
  (slug) => (slug ? watchRace(slug, 3000) : stopRace()),
  { immediate: true },
);

export const raceState = computed(() => (store.race && live.state?.race.slug === store.race.slug ? live.state : null));
export const phase = computed(() => raceState.value?.race.phase ?? null);
export const me = computed(() => raceState.value?.racers.find((r) => r.id === raceState.value.me) ?? null);
export const field = computed(() => raceState.value?.racers.length ?? 0);
// The racer just ahead of me, in the standings.
export const ahead = computed(() => (me.value && me.value.rank > 1 ? raceState.value.racers.find((r) => r.rank === me.value.rank - 1) : null));
export const behind = computed(() => (me.value ? raceState.value.racers.find((r) => r.rank === me.value.rank + 1) : null));
// Before the gun: until the race is known, and while it's in the lobby or counting down.
export const raceWaiting = computed(() => Boolean(store.race) && (!live.loaded || ["lobby", "countdown"].includes(phase.value)));

// In the stalls, the sandbox warms up (store.js sandboxWanted), so it's ready at the gun.
watch(
  raceWaiting,
  (waiting) => {
    store.raceWarm = waiting;
    if (waiting && store.authenticated && store.runtime.enabled) resumeSandbox();
  },
  { immediate: true },
);
// Signed in after this module loaded (the session comes after it): warm up then.
watch(
  () => store.authenticated && store.runtime.enabled,
  (ready) => ready && raceWaiting.value && resumeSandbox(),
);

// The gun: off to the race's first stop, for a racer who hasn't started.
watch(phase, (next, before) => {
  if (next === "racing" && ["lobby", "countdown"].includes(before) && !me.value?.xp) {
    const first = raceState.value?.course.stops[0]?.id;
    if (first) navigate(`#/module/${first}`);
  }
});
