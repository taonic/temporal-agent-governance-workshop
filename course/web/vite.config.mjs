// The course site. The content is generated from the workshop (course/content/build.mjs)
// before every build, and again whenever an assignment or exercise file changes under
// `vite` or `vite build --watch`.
import path from "node:path";
import { fileURLToPath } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

import { contentInputs, writeCourse } from "../content/build.mjs";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const runner = process.env.COURSE_RUNNER_URL ?? "http://127.0.0.1:8787";

function courseContent() {
  return {
    name: "course-content",
    buildStart() {
      writeCourse();
      for (const file of contentInputs()) this.addWatchFile(file);
    },
    configureServer(server) {
      const inputs = new Set(contentInputs());
      server.watcher.add([...inputs]);
      // One rebuild for a burst of changes (render.py rewrites every stage at once). A build that
      // fails (a half-made edit, or another build, a test run's, writing public/content at the
      // same moment) is logged and tried once more, and the server keeps serving the last content.
      let timer = null;
      const rebuild = (retry = true) => {
        try {
          writeCourse();
          server.ws.send({ type: "full-reload" });
        } catch (err) {
          server.config.logger.error(`course content: ${err.message}${retry ? " (trying again)" : ""}`);
          if (retry) timer = setTimeout(() => rebuild(false), 1000);
        }
      };
      server.watcher.on("change", (file) => {
        if (!inputs.has(path.resolve(file))) return;
        clearTimeout(timer);
        timer = setTimeout(rebuild, 200);
      });
    },
  };
}

export default defineConfig({
  root: webDir,
  plugins: [vue(), courseContent()],
  server: {
    proxy: {
      "/api/terminal": { target: runner.replace(/^http/, "ws"), ws: true },
      "/api/lsp": { target: runner.replace(/^http/, "ws"), ws: true },
      // X-Forwarded-Host, so the runner knows the site's origin (the helper's sign-in comes
      // back to it, not to the runner's port).
      "/api": { target: runner, changeOrigin: true, xfwd: true },
      "/sbx": runner,
      "/llm": runner,
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
