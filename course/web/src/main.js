import { createApp } from "vue";

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

if (new URLSearchParams(window.location.search).has("reset")) {
  reset();
} else {
  import("./App.vue").then(({ default: App }) => createApp(App).mount("#app"));
}
