// The workshop files a sandbox gets: the same set goes into the snapshot (so `uv sync` can
// install the project) and is uploaded again when a sandbox is created (so a content change
// only needs a redeploy of the course site, not a new snapshot).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Where the workshop lives inside a sandbox.
export const sandboxRepo = "/workshop";

const FILES = ["pyproject.toml", "uv.lock", "agents.toml", "README.md", "DESIGN.md", ".env.example", ".gitignore"];
const DIRS = [
  "hello", "codemode", "travel_agent", "policies", "challenges", "scripts", "tests",
  "authoring", "starter", "solutions", "docs",
];
const SKIP = /(^|\/)(__pycache__|\.DS_Store|\.pytest_cache|\.ruff_cache)(\/|$)|\.pyc$/;

// Repo-relative paths of every file a sandbox gets, sorted.
export function workshopFiles(root = repoRoot) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (SKIP.test(child)) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  for (const file of FILES) if (fs.existsSync(path.join(root, file))) out.push(file);
  for (const dir of DIRS) if (fs.existsSync(path.join(root, dir))) walk(dir);
  return out.sort();
}

// What the snapshot depends on. Its name carries a hash of these, so the runner can tell
// whether the snapshot it would use matches the dependencies it was deployed with.
const SNAPSHOT_INPUTS = ["pyproject.toml", "uv.lock", "scripts/setup_dogwood.sh", "course/snapshot/Dockerfile", "course/snapshot/lsp_bridge.py"];

export function snapshotName(root = repoRoot) {
  const hash = crypto.createHash("sha256");
  for (const file of SNAPSHOT_INPUTS) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(path.join(root, file)));
  }
  return `governance-course-${hash.digest("hex").slice(0, 12)}`;
}
