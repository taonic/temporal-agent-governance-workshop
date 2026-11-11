// The workshop files a sandbox gets: the same set goes into the snapshot (so `uv sync` can
// install the project) and is uploaded again when a sandbox is created (so a content change
// only needs a redeploy of the course site, not a new snapshot; the files the snapshot has that
// the workshop no longer does are deleted then too: staleFiles).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Where the workshop lives inside a sandbox.
export const sandboxRepo = "/workshop";

const FILES = ["pyproject.toml", "uv.lock", "agents.toml", "README.md", "DESIGN.md", ".env.example", ".gitignore", "quest"];
export const WORKSHOP_DIRS = [
  "hello", "codemode", "travel_agent", "concierge", "essentials", "policies", "quests", "scripts", "tests",
  "authoring", "starter", "docs",
];
// The folders kept current in every sandbox, not only a new one: no learner edits them, so a
// sandbox made before they existed or changed gets them again (SandboxManager #keepCurrent).
export const KEPT_CURRENT = ["essentials"];
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
  for (const dir of WORKSHOP_DIRS) if (fs.existsSync(path.join(root, dir))) walk(dir);
  return out.sort();
}

// The files in a sandbox's workshop folders (`found`, as `find` lists them) that aren't among
// the ones it was given (`wanted`): left from the snapshot, which has the workshop as it was when
// it was built. A module folder since renamed would otherwise sit beside its new copy.
export function staleFiles(found, wanted, dirs = WORKSHOP_DIRS) {
  const keep = new Set(wanted);
  const inWorkshop = (rel) => dirs.some((dir) => rel.startsWith(`${dir}/`));
  return found
    .map((line) => line.trim().replace(/^\.\//, ""))
    .filter((rel) => rel && inWorkshop(rel) && !SKIP.test(rel) && !keep.has(rel));
}

// The kept-current folders' files, and a stamp of what's in them: a sandbox with this stamp has them as they are.
export function keptCurrent(root = repoRoot) {
  const rels = workshopFiles(root).filter((rel) => KEPT_CURRENT.some((dir) => rel.startsWith(`${dir}/`)));
  const hash = crypto.createHash("sha256");
  for (const rel of rels) {
    hash.update(`${rel}\0`);
    hash.update(fs.readFileSync(path.join(root, rel)));
  }
  return { rels, stamp: hash.digest("hex").slice(0, 12) };
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
