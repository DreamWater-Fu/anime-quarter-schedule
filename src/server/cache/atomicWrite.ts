import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeJsonAtomically(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${path}.bak`;

  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await copyFile(path, backupPath).catch(() => undefined);

  try {
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
