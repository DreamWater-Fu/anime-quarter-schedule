import { getDefaultStorage } from "./jsonFileStorage.ts";
import type { AnimeStorage } from "./storage.ts";
import type { UpdateStatusPayload } from "../types/api.ts";

export async function readUpdateStatus(storage: AnimeStorage = getDefaultStorage()): Promise<UpdateStatusPayload> {
  return storage.readUpdateStatus();
}

export async function writeUpdateStatus(
  status: UpdateStatusPayload,
  storage: AnimeStorage = getDefaultStorage()
): Promise<void> {
  await storage.writeUpdateStatus(status);
}
