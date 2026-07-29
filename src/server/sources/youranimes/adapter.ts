import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isValidDateString,
  seasonKeyEquals
} from "../../anime/calculateSeason.ts";
import type { AnimeItem, AnimeSource, SeasonKey, SeasonMonth } from "../../types/anime.ts";
import type { AnimeSourceAdapter, SourceFetchInput, SourceFetchResult, SourceIssue } from "../types.ts";

export interface YourAnimesAdapterOptions {
  enabled?: boolean;
  timetableUrls?: string[];
  timetableFiles?: string[];
  fetchImpl?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export interface YourAnimesReferenceEntry {
  title: string;
  aliases: string[];
  url: string;
  publishedAt: string;
  bangumiSubjectId: number | null;
  retrievedAt: string;
}

export class YourAnimesSourceAdapter implements AnimeSourceAdapter {
  readonly name = "YourAnimes";
  readonly sourceType = "third_party" as const;
  readonly enabled: boolean;
  private readonly timetableUrls: string[];
  private readonly timetableFiles: string[];
  private readonly hasExplicitTimetableUrls: boolean;
  private readonly hasExplicitTimetableFiles: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: YourAnimesAdapterOptions = {}) {
    this.enabled = options.enabled ?? process.env.YOURANIMES_ENABLED !== "false";
    this.hasExplicitTimetableUrls = options.timetableUrls !== undefined;
    this.hasExplicitTimetableFiles = options.timetableFiles !== undefined;
    this.timetableUrls = options.timetableUrls ?? splitEnvList(process.env.YOURANIMES_TIMETABLE_URLS);
    this.timetableFiles = options.timetableFiles ?? splitEnvList(process.env.YOURANIMES_TIMETABLE_FILES);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? process.env.YOURANIMES_USER_AGENT ?? "anime-quarter-schedule-local/0.1.0 (contact: local-dev)";
    this.timeoutMs = options.timeoutMs ?? parsePositiveInteger(process.env.YOURANIMES_TIMEOUT_MS, 15_000);
    this.now = options.now ?? (() => new Date());
  }

  async fetchSeason(input: SourceFetchInput): Promise<SourceFetchResult> {
    const retrievedAt = this.now().toISOString();
    if (!this.enabled) {
      return {
        source: this.name,
        sourceType: this.sourceType,
        items: [],
        warnings: [{ source: this.name, code: "SOURCE_DISABLED", message: "YourAnimes adapter is disabled", retryable: false }],
        fallbackUsed: false,
        retrievedAt
      };
    }

    const warnings: SourceIssue[] = [];
    const entries = await this.readEntries(input, retrievedAt, warnings);
    const targetSeason: SeasonKey = { year: input.year, quarter: input.quarter };
    const items = entries
      .map((entry) => mapYourAnimesReferenceToAnimeItem(entry, retrievedAt))
      .filter((item): item is AnimeItem => item !== null)
      .filter((item) => seasonKeyEquals(item.primarySeason, targetSeason));

    return {
      source: this.name,
      sourceType: this.sourceType,
      items,
      warnings,
      fallbackUsed: false,
      retrievedAt
    };
  }

  private async readEntries(
    input: SourceFetchInput,
    retrievedAt: string,
    warnings: SourceIssue[]
  ): Promise<YourAnimesReferenceEntry[]> {
    const entries: YourAnimesReferenceEntry[] = [];

    for (const file of await this.resolveTimetableFiles(input)) {
      try {
        const html = await readFile(resolve(/* turbopackIgnore: true */ process.cwd(), file), "utf8");
        entries.push(...parseYourAnimesHtml(html, { url: file, retrievedAt }));
      } catch (error) {
        warnings.push({
          source: this.name,
          code: "NETWORK_FAILED",
          message: `failed to read YourAnimes timetable file: ${file}`,
          retryable: false,
          details: error instanceof Error ? error.message : error
        });
      }
    }

    for (const url of this.resolveTimetableUrls(input)) {
      try {
        const response = await this.fetchWithTimeout(url);
        if (!response.ok) {
          warnings.push({
            source: this.name,
            code: response.status === 403 || response.status === 451 ? "SOURCE_BLOCKED" : "NETWORK_FAILED",
            message: `YourAnimes timetable request failed with HTTP ${response.status}: ${url}`,
            retryable: response.status >= 500 || response.status === 429,
            status: response.status
          });
          continue;
        }
        entries.push(...parseYourAnimesHtml(await response.text(), { url, retrievedAt }));
      } catch (error) {
        warnings.push({
          source: this.name,
          code: "NETWORK_FAILED",
          message: `failed to fetch YourAnimes timetable: ${url}`,
          retryable: true,
          details: error instanceof Error ? error.message : error
        });
      }
    }

    return dedupeEntries(entries);
  }

  private async resolveTimetableFiles(input: SourceFetchInput): Promise<string[]> {
    if (this.timetableFiles.length > 0) return this.timetableFiles;
    if (this.hasExplicitTimetableFiles) return [];
    const defaultFile = `${process.env.DATA_DIR ?? "data"}/youranimes-${input.year}${String(input.season).padStart(2, "0")}.html`;
    try {
      await access(resolve(/* turbopackIgnore: true */ process.cwd(), defaultFile));
      return [defaultFile];
    } catch {
      return [];
    }
  }

  private resolveTimetableUrls(input: SourceFetchInput): string[] {
    if (this.timetableUrls.length > 0) return this.timetableUrls;
    if (this.hasExplicitTimetableUrls) return [];
    return [`https://youranimes.tw/bangumi/${input.year}${String(input.season).padStart(2, "0")}`];
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: {
          "User-Agent": this.userAgent,
          "Accept-Language": "zh-TW,zh;q=0.9,ja;q=0.8,en;q=0.5"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseYourAnimesHtml(
  html: string,
  options: { url: string; retrievedAt: string }
): YourAnimesReferenceEntry[] {
  const entries: YourAnimesReferenceEntry[] = [];
  const scriptPattern = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;

  for (const match of html.matchAll(scriptPattern)) {
    const rawJson = htmlDecode(match[1] ?? "");
    let payload: unknown;
    try {
      payload = JSON.parse(rawJson);
    } catch {
      continue;
    }

    for (const series of walkJsonLd(payload)) {
      const title = typeof series.name === "string" ? series.name.trim() : "";
      const publishedAt = typeof series.datePublished === "string" ? series.datePublished : "";
      if (!title || !publishedAt) continue;
      entries.push({
        title,
        aliases: extractAliases(series.alternateName),
        url: typeof series.url === "string" ? series.url : options.url,
        publishedAt,
        bangumiSubjectId: extractBangumiSubjectId(series.sameAs),
        retrievedAt: options.retrievedAt
      });
    }
  }

  return dedupeEntries(entries);
}

export function mapYourAnimesReferenceToAnimeItem(
  entry: YourAnimesReferenceEntry,
  fallbackRetrievedAt: string
): AnimeItem | null {
  const beijingSlot = publishedAtToBeijingDateTime(entry.publishedAt);
  if (!beijingSlot) return null;

  const retrievedAt = entry.retrievedAt || fallbackRetrievedAt;
  const source = createYourAnimesSource(entry, retrievedAt);
  const schedule = [
    {
      episodeNumber: null,
      episodeTitle: null,
      airDate: beijingSlot.date,
      airTime: beijingSlot.time,
      timezone: "Asia/Shanghai" as const,
      status: "confirmed" as const,
      source
    }
  ];
  const primarySeason = calculatePrimarySeason(beijingSlot.date);
  const bangumiSubjectId = Number.isInteger(entry.bangumiSubjectId) ? Number(entry.bangumiSubjectId) : null;

  return {
    id: bangumiSubjectId !== null ? `anime:${bangumiSubjectId}` : `anime:youranimes:${slugify(entry.title)}`,
    title: {
      original: entry.title,
      japanese: null,
      chinese: entry.title,
      english: null,
      aliases: entry.aliases
    },
    format: "tv",
    status: "airing",
    startDate: beijingSlot.date,
    endDate: null,
    datePrecision: "day",
    primarySeason,
    activeSeasons: calculateActiveSeasons({ schedule, fallbackPrimarySeason: primarySeason }),
    updateWeekday: inferUpdateWeekday({ schedule, startDate: beijingSlot.date }),
    updateTime: beijingSlot.time,
    timezone: "Asia/Shanghai",
    episodeCount: null,
    airedEpisodeCount: null,
    isJapaneseAnime: true,
    inclusionStatus: "included",
    officialUrl: entry.url.startsWith("http") ? entry.url : null,
    coverImage: null,
    externalIds: {
      bangumiSubjectId,
      bahamutSn: null
    },
    bangumi: {
      subjectId: bangumiSubjectId,
      url: bangumiSubjectId !== null ? `https://bgm.tv/subject/${bangumiSubjectId}` : null,
      rating: null,
      ratingCount: null,
      rank: null,
      lastSyncedAt: null
    },
    schedule,
    staff: null,
    sources: [source],
    dataStatus: "partial",
    updatedAt: retrievedAt,
    createdAt: retrievedAt
  };
}

function createYourAnimesSource(entry: YourAnimesReferenceEntry, retrievedAt: string): AnimeSource {
  return {
    name: "YourAnimes",
    type: "third_party",
    url: entry.url,
    retrievedAt,
    scope: "japan_broadcast"
  };
}

function publishedAtToBeijingDateTime(value: string): { date: string; time: string } | null {
  const timestamp = Date.parse(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function walkJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(walkJsonLd);

  const record = value as Record<string, unknown>;
  const result: Array<Record<string, unknown>> = [];
  if (record["@type"] === "TVSeries") result.push(record);
  if (Array.isArray(record.itemListElement)) {
    for (const item of record.itemListElement) {
      if (item && typeof item === "object" && "item" in item) {
        result.push(...walkJsonLd((item as { item?: unknown }).item));
      } else {
        result.push(...walkJsonLd(item));
      }
    }
  }
  if (record.item) result.push(...walkJsonLd(record.item));
  if (Array.isArray(record["@graph"])) result.push(...walkJsonLd(record["@graph"]));
  return result;
}

function extractBangumiSubjectId(value: unknown): number | null {
  const urls = Array.isArray(value) ? value : [value];
  for (const url of urls) {
    if (typeof url !== "string") continue;
    const match = /(?:bgm\.tv|bangumi\.tv)\/subject\/(\d+)/u.exec(url);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractAliases(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return [...new Set(raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function htmlDecode(value: string): string {
  return value
    .replace(/&quot;/gi, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#x22;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'");
}

function dedupeEntries(entries: YourAnimesReferenceEntry[]): YourAnimesReferenceEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.bangumiSubjectId ?? ""}:${entry.title.normalize("NFKC").trim().toLowerCase()}:${entry.publishedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function slugify(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-+|-+$/g, "") || "unknown";
}
