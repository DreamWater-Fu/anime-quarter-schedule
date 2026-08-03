import { getDefaultStorage } from "./jsonFileStorage.ts";
import type { AnimeStorage } from "./storage.ts";
import type { UpdateStatusPayload } from "../types/api.ts";

export async function readUpdateStatus(
  storage: AnimeStorage = getDefaultStorage(),
  now: () => Date = () => new Date()
): Promise<UpdateStatusPayload> {
  const status = await storage.readUpdateStatus();
  const normalized = normalizeStaleUpdateStatus(status, now);
  if (normalized !== status) await storage.writeUpdateStatus(normalized);
  return normalized;
}

export async function writeUpdateStatus(
  status: UpdateStatusPayload,
  storage: AnimeStorage = getDefaultStorage()
): Promise<void> {
  await storage.writeUpdateStatus(status);
}

export function normalizeStaleUpdateStatus(
  status: UpdateStatusPayload,
  now: () => Date = () => new Date()
): UpdateStatusPayload {
  if (status.status !== "running" || !status.currentJob) return status;

  const ttlSeconds = parsePositiveInteger(process.env.UPDATE_LOCK_TTL_SECONDS, 900);
  const startedAt = Date.parse(status.currentJob.startedAt);
  if (!Number.isFinite(startedAt)) return status;

  const currentTime = now();
  const ageMs = currentTime.getTime() - startedAt;
  if (ageMs <= ttlSeconds * 1000) return status;

  return {
    ...status,
    status: "failed",
    currentJob: null,
    lastError: {
      code: "STALE_UPDATE_LOCK",
      message: "previous update job exceeded the lock TTL and was released",
      at: currentTime.toISOString()
    }
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
