// What the site keeps in this browser, and how it forgets a sandbox's work. No imports, so
// main.js can forget before the app (and the store, which reads local storage as it loads) does.

export const storagePrefix = "governed-agents-course";
export const storageKey = (...parts) => [storagePrefix, ...parts].join(":");

// What a new sandbox keeps from this browser: settings, not work. Everything else the site (and
// the Agent UI, on this origin) keeps is about the sandbox that's gone: Ask Temporal's threads,
// where each guide was, steps ticked, checks passed, the Agent UI's sessions.
const KEPT = new Set(["theme", "onboarded", "code-width", "dock-height", "helper-width", "helper-include-code"].map((key) => storageKey(key)));

export function forgetWork() {
  try {
    for (const key of Object.keys(localStorage)) if (!KEPT.has(key)) localStorage.removeItem(key);
    sessionStorage.clear();
  } catch {
    /* storage unavailable: nothing kept to forget */
  }
}
