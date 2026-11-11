// Who the course is shown to: the learner's persona (quests/personas.yaml), and the course as that
// persona sees it. The Developer persona sees every branch but Essentials; the Non-developer
// persona sees only Essentials. Everything the site lists (branches, modules, paths, exercises,
// badges) comes from the course this returns, so this is the one place that filters.
//
// Where the persona comes from, first to last: ?persona= in the URL, what the learner chose (kept
// in this browser, and on the server as a persona_set event), else the default (the first
// persona) without a choice made: the site then asks (PersonaChoice.vue). Switching reloads the
// page, since the course is worked out once, as the site loads.
import { storageKey } from "./forget.js";

const KEY = storageKey("persona");

// The course as `persona` sees it.
export function courseFor(full, persona) {
  const sees = (item) => (item.personas ?? [full.personas?.[0]?.id]).includes(persona);
  const branches = full.branches.filter(sees);
  const branchIds = new Set(branches.map((b) => b.id));
  return {
    ...full,
    persona,
    branches,
    modules: full.modules.filter((m) => branchIds.has(m.branch)),
    paths: full.paths.filter(sees),
    exercises: full.exercises.filter(sees),
    badges: full.badges.filter(sees),
  };
}

function stored() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

// { id, chosen, fromUrl }: the persona to show, whether it was chosen (or set) rather than
// defaulted, and whether the URL set it. A ?persona= that names one is kept, as if chosen.
export function readPersona(full, search = window.location.search) {
  const ids = (full.personas ?? []).map((p) => p.id);
  const fromUrl = new URLSearchParams(search).get("persona");
  if (ids.includes(fromUrl)) {
    keepPersona(fromUrl);
    return { id: fromUrl, chosen: true, fromUrl: true };
  }
  const saved = stored();
  if (ids.includes(saved)) return { id: saved, chosen: true, fromUrl: false };
  return { id: ids[0] ?? "developer", chosen: false, fromUrl: false };
}

export function keepPersona(id) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* storage unavailable: it's chosen for this page only */
  }
}

// The persona whose course has a module: for a link to a module the current persona can't see.
export function personaOfModule(full, moduleId) {
  const m = full.modules.find((x) => x.id === moduleId);
  const branch = m && full.branches.find((b) => b.id === m.branch);
  return branch?.personas?.[0] ?? null;
}
