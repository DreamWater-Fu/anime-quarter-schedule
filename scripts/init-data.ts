import { loadLocalEnv } from "../src/server/config/env.ts";
import { JsonFileStorage } from "../src/server/cache/jsonFileStorage.ts";

loadLocalEnv();

const storage = new JsonFileStorage();
await storage.init();

console.log(`initialized data cache at ${storage.dataDir}`);
