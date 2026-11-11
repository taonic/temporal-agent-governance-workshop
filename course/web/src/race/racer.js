// A racer starts from nothing: this browser forgets what it kept for anyone before (their progress,
// their guides, their sandbox's work), keeps the theme, learns as Essentials, skips the welcome
// intro, and opens the course. The runner never imports a racer's browser progress either
// (race.mjs), so nobody starts ahead. No imports but forget.js: the join page loads without the
// course.
import { storageKey, storagePrefix } from "../forget.js";

export function startRacing(race) {
  try {
    const theme = localStorage.getItem(storageKey("theme"));
    for (const key of Object.keys(localStorage)) if (key.startsWith(`${storagePrefix}:`)) localStorage.removeItem(key);
    sessionStorage.clear();
    if (theme) localStorage.setItem(storageKey("theme"), theme);
    localStorage.setItem(storageKey("persona"), JSON.stringify("essentials"));
    localStorage.setItem(storageKey("intro-seen-at"), JSON.stringify(Date.now()));
    localStorage.setItem(storageKey("race-slug"), JSON.stringify(race?.slug ?? null));
  } catch {
    /* storage unavailable: the course still opens */
  }
  window.location.replace("/#/");
}
