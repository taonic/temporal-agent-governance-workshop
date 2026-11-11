import { createApp } from "vue";

import { forgetWork } from "./forget.js";
import "./styles.css";

// ?reset (https://…/?reset): the workshop from a blank canvas, as a new learner gets it. Deletes
// this learner's sandbox, disconnects the docs, signs out, and clears everything the site keeps
// in this browser (the Agent UI's too: it's on this origin), then loads the home page. The app
// loads only after, since the store reads local storage as it loads.
async function reset() {
  document.getElementById("app").textContent = "Resetting your workshop…";
  const call = (path, method) => fetch(path, { method, credentials: "same-origin" }).catch(() => null);
  await call("/api/sandbox/reset", "POST"); // signed out: there's no sandbox to delete
  await call("/api/helper/connect", "DELETE");
  await call("/api/session", "DELETE");
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* storage unavailable: nothing kept to clear */
  }
  window.location.replace(window.location.pathname);
}

// ?purge: clears the site's cookies, and nothing else. It signs out (the session cookie) and
// disconnects the docs (Ask Temporal's), but keeps the sandbox and what this browser keeps
// (progress, the persona). The cookies are HttpOnly, so the runner clears them. Then the same
// page loads again, without ?purge.
async function purge() {
  document.getElementById("app").textContent = "Clearing your cookies…";
  const call = (path, method) => fetch(path, { method, credentials: "same-origin" }).catch(() => null);
  await call("/api/helper/connect", "DELETE");
  await call("/api/session", "DELETE");
  params.delete("purge");
  const rest = params.toString();
  window.location.replace(`${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
}

const params = new URLSearchParams(window.location.search);
// The Derby (race/): its screen for the projector (/race/<slug>) and its join page (/join, or
// /join/<code>), each a page of its own, without the course around it.
const racePage = window.location.pathname.match(/^\/race\/([a-z0-9-]+)\/?$/);
const joinPage = window.location.pathname.match(/^\/join(?:\/([A-Za-z0-9-]+))?\/?$/);
if (racePage) {
  import("./race/RaceScreen.vue").then(({ default: RaceScreen }) => createApp(RaceScreen, { slug: racePage[1] }).mount("#app"));
} else if (joinPage) {
  import("./race/JoinPage.vue").then(({ default: JoinPage }) => createApp(JoinPage, { code: joinPage[1] ?? "" }).mount("#app"));
} else if (params.has("reset")) {
  reset();
} else if (params.has("purge")) {
  purge();
} else {
  // ?forget: just after Start over (store.js resetSandbox). The old sandbox's work is forgotten
  // again here, before the app reads anything, in case a page wrote some back as it unloaded.
  if (params.has("forget")) {
    forgetWork();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  }
  import("./App.vue").then(({ default: App }) => createApp(App).mount("#app"));
}
