import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const staticDataDir = resolve(root, "public/static-data");

await mkdir(staticDataDir, { recursive: true });
await copyFile(resolve(root, "data/anime.json"), resolve(staticDataDir, "anime.json"));
await copyFile(resolve(root, "data/status.json"), resolve(staticDataDir, "status.json"));
await writeFile(resolve(root, "public/.nojekyll"), "", "utf8");

console.log(`static export data prepared at ${dirname(resolve(staticDataDir, "anime.json"))}`);
