import { appendFile, access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { hasBlockingValidationIssues, validateAnimeCache } from "../anime/validateAnime.ts";
import type { AnimeCache } from "../types/anime.ts";
import type { UpdateLogEntry, UpdateStatusPayload } from "../types/api.ts";
import { ApiErrorException } from "../utils/errors.ts";
import { writeJsonAtomically } from "./atomicWrite.ts";
import { createEmptyAnimeCache, createEmptyUpdateStatus, type AnimeStorage } from "./storage.ts";

export interface JsonFileStorageOptions {
  dataDir?: string;
}

export class JsonFileStorage implements AnimeStorage {
  readonly dataDir: string;
  readonly animePath: string;
  readonly statusPath: string;
  readonly updateLogPath: string;
  readonly bahamutReferencesPath: string;
  readonly bahamutTimetablePath: string;
  readonly rawDir: string;

  constructor(options: JsonFileStorageOptions = {}) {
    this.dataDir = resolve(/* turbopackIgnore: true */ process.cwd(), options.dataDir ?? process.env.DATA_DIR ?? "data");
    this.animePath = join(this.dataDir, "anime.json");
    this.statusPath = join(this.dataDir, "status.json");
    this.updateLogPath = join(this.dataDir, "update-log.jsonl");
    this.bahamutReferencesPath = join(this.dataDir, "bahamut-references.json");
    this.bahamutTimetablePath = join(this.dataDir, "bahamut-timetable.html");
    this.rawDir = join(this.dataDir, "raw");
  }

  async init(): Promise<void> {
    await mkdir(this.rawDir, { recursive: true });
    if (!(await pathExists(this.animePath))) await this.writeAnimeCache(createEmptyAnimeCache());
    if (!(await pathExists(this.statusPath))) await this.writeUpdateStatus(createEmptyUpdateStatus());
    if (!(await pathExists(this.bahamutReferencesPath))) await writeJsonAtomically(this.bahamutReferencesPath, []);
    if (!(await pathExists(this.bahamutTimetablePath))) {
      await writeFile(this.bahamutTimetablePath, "<!-- Save Bahamut timetable HTML or text here when direct fetch is blocked. -->\n", "utf8");
    }
    await appendFile(this.updateLogPath, "", "utf8");
  }

  async readAnimeCache(): Promise<AnimeCache> {
    return this.readJsonFile(this.animePath, createEmptyAnimeCache);
  }

  async writeAnimeCache(cache: AnimeCache): Promise<void> {
    const issues = validateAnimeCache(cache);
    if (hasBlockingValidationIssues(issues)) {
      throw new ApiErrorException("CACHE_VALIDATION_FAILED", "anime cache validation failed", {
        status: 500,
        details: issues.filter((issue) => issue.severity === "error")
      });
    }
    await writeJsonAtomically(this.animePath, cache);
  }

  async readUpdateStatus(): Promise<UpdateStatusPayload> {
    return this.readJsonFile(this.statusPath, createEmptyUpdateStatus);
  }

  async writeUpdateStatus(status: UpdateStatusPayload): Promise<void> {
    await writeJsonAtomically(this.statusPath, status);
  }

  async appendUpdateLog(entry: UpdateLogEntry): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await appendFile(this.updateLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private async readJsonFile<T>(path: string, fallback: () => T): Promise<T> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return fallback();
      }
      throw error;
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let defaultStorage: JsonFileStorage | null = null;

export function getDefaultStorage(): JsonFileStorage {
  defaultStorage ??= new JsonFileStorage();
  return defaultStorage;
}
