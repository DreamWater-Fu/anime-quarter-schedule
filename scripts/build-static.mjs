import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function defaultBasePath() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return "";
  const name = repository.split("/").pop();
  return name ? `/${name}` : "";
}

const apiDir = resolve(process.cwd(), "app/api");
const disabledApiDir = resolve(process.cwd(), `.static-export-disabled/api-${Date.now()}`);

try {
  await run("node", ["scripts/prepare-static-export.mjs"]);
  await rm(resolve(process.cwd(), ".next"), { force: true, recursive: true });
  if (existsSync(apiDir)) {
    await mkdir(dirname(disabledApiDir), { recursive: true });
    await rename(apiDir, disabledApiDir);
  }
  await run("npx", ["next", "build"], {
    env: {
      ...process.env,
      NEXT_PUBLIC_STATIC_EXPORT: "true",
      NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH ?? defaultBasePath()
    }
  });
} finally {
  if (existsSync(disabledApiDir) && !existsSync(apiDir)) {
    await rename(disabledApiDir, apiDir);
  }
}
