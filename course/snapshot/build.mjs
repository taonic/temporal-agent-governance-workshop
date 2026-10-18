// Builds the learner sandbox snapshot.
//
//   node course/snapshot/build.mjs            # build it on Daytona (needs DAYTONA_API_KEY)
//   node course/snapshot/build.mjs --local    # build the same image with local Docker, to test it
//   node course/snapshot/build.mjs --name     # print the snapshot name the runner will use
//
// The name carries a hash of the snapshot's inputs (see repo-files.mjs), so a deploy whose
// dependencies changed asks for a snapshot that doesn't exist yet, and the runner says so,
// instead of quietly running learners on stale dependencies.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Daytona, Image } from "@daytonaio/sdk";

import { repoRoot, snapshotName, workshopFiles } from "../runner/repo-files.mjs";

// Per-sandbox resources (a snapshot fixes them for every sandbox made from it): the Temporal
// dev server, three or four Python processes, the verifier, and the second Temporal that
// the pytest checks start.
const RESOURCES = { cpu: 2, memory: 4, disk: 5 };

function stageContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "governance-snapshot-"));
  fs.copyFileSync(path.join(repoRoot, "course/snapshot/Dockerfile"), path.join(dir, "Dockerfile"));
  fs.copyFileSync(path.join(repoRoot, "course/snapshot/lsp_bridge.py"), path.join(dir, "lsp_bridge.py"));
  for (const rel of workshopFiles()) {
    const dest = path.join(dir, "workshop", rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), dest);
  }
  return dir;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const name = snapshotName();
  if (args.has("--name")) {
    console.log(name);
    return;
  }

  const context = stageContext();
  console.log(`Staged the build context in ${context}`);

  if (args.has("--local")) {
    execFileSync("docker", ["build", "-t", name, context], { stdio: "inherit" });
    console.log(`\n✓ Built ${name} locally. Try it: docker run --rm -it ${name} bash`);
    return;
  }

  const daytona = new Daytona();
  try {
    const existing = await daytona.snapshot.get(name);
    if (!args.has("--force")) {
      console.log(`✓ Snapshot ${name} already exists (${existing.state}). --force rebuilds it.`);
      return;
    }
    console.log(`Deleting the existing ${name}...`);
    await daytona.snapshot.delete(existing);
  } catch (err) {
    if (!/not found/i.test(String(err?.message))) throw err;
  }

  console.log(`Building snapshot ${name} on Daytona (compiling Dogwood takes a while)...`);
  await daytona.snapshot.create(
    {
      name,
      image: Image.fromDockerfile(path.join(context, "Dockerfile")),
      resources: RESOURCES,
      entrypoint: ["sleep", "infinity"],
    },
    { onLogs: (chunk) => process.stdout.write(chunk.endsWith("\n") ? chunk : `${chunk}\n`), timeout: 0 },
  );
  console.log(`\n✓ Snapshot ${name} is ready.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
