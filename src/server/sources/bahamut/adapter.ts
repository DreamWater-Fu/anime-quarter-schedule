import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isValidDateString,
  isValidTimeString
} from "../../anime/calculateSeason.ts";
import type { AnimeFormat, AnimeItem, AnimeSource, SeasonKey } from "../../types/anime.ts";
import type { AnimeSourceAdapter, SourceFetchInput, SourceFetchResult, SourceIssue } from "../types.ts";

export interface BahamutReferenceEntry {
  title: string;
  url: string;
  sn: string | null;
  uploadDate: string | null;
  uploadTime: string | null;
  bangumiSubjectId?: number | null;
  format?: AnimeFormat | null;
  retrievedAt: string;
}

export interface BahamutAdapterOptions {
  enabled?: boolean;
  entries?: BahamutReferenceEntry[];
  referencesPath?: string;
  timetableUrls?: string[];
  timetableFiles?: string[];
  fetchImpl?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
  rateLimitPerMinute?: number;
  useDefaultTimetableUrls?: boolean;
  now?: () => Date;
}

export interface BahamutTimetableParseOptions {
  year: number;
  season?: number;
  url?: string;
  retrievedAt: string;
}

const DEFAULT_TIMETABLE_URLS: Record<string, string[]> = {
  "2026-7": [
    "https://forum.gamer.com.tw/C.php?bsn=60037&snA=82874",
    "https://gnn.gamer.com.tw/detail.php?sn=307681"
  ]
};

export class BahamutSourceAdapter implements AnimeSourceAdapter {
  readonly name = "Bahamut Anime Crazy";
  readonly sourceType = "streaming_platform" as const;
  readonly enabled: boolean;
  private readonly entries: BahamutReferenceEntry[];
  private readonly referencesPath: string;
  private readonly timetableUrls: string[];
  private readonly timetableFiles: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly rateLimitPerMinute: number;
  private readonly useDefaultTimetableUrls: boolean;
  private readonly now: () => Date;
  private readonly requestTimes: number[] = [];

  constructor(options: BahamutAdapterOptions = {}) {
    this.enabled = options.enabled ?? process.env.BAHAMUT_ENABLED !== "false";
    this.entries = options.entries ?? [];
    this.referencesPath = resolve(/* turbopackIgnore: true */ process.cwd(), options.referencesPath ?? process.env.BAHAMUT_REFERENCES_FILE ?? `${process.env.DATA_DIR ?? "data"}/bahamut-references.json`);
    this.timetableUrls = options.timetableUrls ?? splitEnvList(process.env.BAHAMUT_TIMETABLE_URLS);
    this.timetableFiles = options.timetableFiles ?? splitEnvList(process.env.BAHAMUT_TIMETABLE_FILES ?? `${process.env.DATA_DIR ?? "data"}/bahamut-timetable.html`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? process.env.BAHAMUT_USER_AGENT ?? "anime-quarter-schedule-local/0.1.1 (contact: local-dev)";
    this.timeoutMs = options.timeoutMs ?? parsePositiveInteger(process.env.BAHAMUT_TIMEOUT_MS, 15_000);
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? parsePositiveInteger(process.env.BAHAMUT_RATE_LIMIT_PER_MINUTE, 3);
    this.useDefaultTimetableUrls = options.useDefaultTimetableUrls ?? (options.entries === undefined && options.timetableUrls === undefined);
    this.now = options.now ?? (() => new Date());
  }

  async fetchSeason(input: SourceFetchInput): Promise<SourceFetchResult> {
    const retrievedAt = this.now().toISOString();

    if (!this.enabled) {
      return {
        source: this.name,
        sourceType: this.sourceType,
        items: [],
        warnings: [
          {
            source: this.name,
            code: "SOURCE_DISABLED",
            message: "Bahamut adapter is disabled",
            retryable: false
          }
        ],
        fallbackUsed: false,
        retrievedAt
      };
    }

    const warnings: SourceIssue[] = [];
    const entries = [...this.entries, ...(await this.readReferenceFile()), ...(await this.readTimetableEntries(input, retrievedAt, warnings))];
    const targetSeason: SeasonKey = { year: input.year, quarter: input.quarter };
    const items = entries
      .map((entry) => mapBahamutReferenceToAnimeItem(entry, retrievedAt))
      .filter((item): item is AnimeItem => item !== null)
      .filter((item) => item.activeSeasons.some((season) => season.year === targetSeason.year && season.quarter === targetSeason.quarter));

    return {
      source: this.name,
      sourceType: this.sourceType,
      items,
      warnings,
      fallbackUsed: false,
      retrievedAt
    };
  }

  private async readReferenceFile(): Promise<BahamutReferenceEntry[]> {
    try {
      const payload = JSON.parse(await readFile(this.referencesPath, "utf8")) as unknown;
      if (Array.isArray(payload)) return payload.filter(isBahamutReferenceEntry);
      if (payload && typeof payload === "object" && Array.isArray((payload as { entries?: unknown }).entries)) {
        return (payload as { entries: unknown[] }).entries.filter(isBahamutReferenceEntry);
      }
      return [];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  private async readTimetableEntries(input: SourceFetchInput, retrievedAt: string, warnings: SourceIssue[]): Promise<BahamutReferenceEntry[]> {
    const entries: BahamutReferenceEntry[] = [];

    for (const file of this.timetableFiles) {
      try {
        const text = await readFile(resolve(/* turbopackIgnore: true */ process.cwd(), file), "utf8");
        entries.push(...parseBahamutTimetableText(text, { year: input.year, season: input.season, url: file, retrievedAt }));
      } catch (error) {
        warnings.push({
          source: this.name,
          code: "NETWORK_FAILED",
          message: `failed to read Bahamut timetable file: ${file}`,
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
            message: `Bahamut timetable request failed with HTTP ${response.status}: ${url}`,
            retryable: response.status >= 500 || response.status === 429,
            status: response.status
          });
          continue;
        }
        entries.push(...parseBahamutTimetableText(await response.text(), { year: input.year, season: input.season, url, retrievedAt }));
      } catch (error) {
        warnings.push({
          source: this.name,
          code: "NETWORK_FAILED",
          message: `failed to fetch Bahamut timetable: ${url}`,
          retryable: true,
          details: error instanceof Error ? error.message : error
        });
      }
    }

    return dedupeReferenceEntries(entries);
  }

  private resolveTimetableUrls(input: SourceFetchInput): string[] {
    if (this.timetableUrls.length > 0) return this.timetableUrls;
    if (!this.useDefaultTimetableUrls) return [];
    return DEFAULT_TIMETABLE_URLS[`${input.year}-${input.season}`] ?? [];
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    await this.waitForRateLimitSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: {
          "User-Agent": this.userAgent,
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForRateLimitSlot(): Promise<void> {
    if (!Number.isFinite(this.rateLimitPerMinute) || this.rateLimitPerMinute <= 0) return;

    const windowMs = 60_000;
    const now = Date.now();
    while (this.requestTimes.length > 0 && now - this.requestTimes[0]! >= windowMs) {
      this.requestTimes.shift();
    }

    if (this.requestTimes.length >= this.rateLimitPerMinute) {
      const waitMs = windowMs - (now - this.requestTimes[0]!);
      await delay(Math.max(waitMs, 0));
    }

    this.requestTimes.push(Date.now());
  }
}

export function parseBahamutTimetableText(text: string, options: BahamutTimetableParseOptions): BahamutReferenceEntry[] {
  const normalizedText = htmlToText(text).normalize("NFKC");
  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const entries: BahamutReferenceEntry[] = [];
  let lastTitle: string | null = null;
  let currentDate: string | null = null;

  for (const line of lines) {
    const dateHeader = extractDateHeader(line, options.year);
    if (dateHeader) currentDate = dateHeader;

    const title = extractQuotedTitle(line) ?? extractTitleAfterTime(line);
    if (title) lastTitle = title;

    const recurringSlot = extractRecurringSlot(line, options.year);
    if (recurringSlot && (title ?? lastTitle)) {
      entries.push(createParsedReferenceEntry(title ?? lastTitle!, recurringSlot.date, recurringSlot.time, options));
      continue;
    }

    const explicitSlot = extractExplicitSlot(line, options.year);
    if (explicitSlot && (title ?? lastTitle)) {
      entries.push(createParsedReferenceEntry(title ?? lastTitle!, explicitSlot.date, explicitSlot.time, options));
      continue;
    }

    const timeOnlySlot = extractTimeOnlySlot(line);
    if (timeOnlySlot && currentDate && (title ?? lastTitle)) {
      entries.push(createParsedReferenceEntry(title ?? lastTitle!, currentDate, timeOnlySlot.time, options));
    }
  }

  return dedupeReferenceEntries(entries);
}

export function createBahamutReferenceSource(entry: BahamutReferenceEntry): AnimeSource {
  return {
    name: "Bahamut Anime Crazy",
    type: "streaming_platform",
    url: entry.url,
    retrievedAt: entry.retrievedAt,
    scope: "taiwan_streaming"
  };
}

export function mapBahamutReferenceToAnimeItem(entry: BahamutReferenceEntry, fallbackRetrievedAt: string): AnimeItem | null {
  if (!isValidDateString(entry.uploadDate)) return null;
  const retrievedAt = entry.retrievedAt || fallbackRetrievedAt;
  const beijingSlot = isValidTimeString(entry.uploadTime)
    ? taipeiTimeToBeijingDateTime(entry.uploadDate, entry.uploadTime)
    : { date: entry.uploadDate, time: null };
  const schedule = [
    {
      episodeNumber: null,
      episodeTitle: null,
      airDate: beijingSlot.date,
      airTime: beijingSlot.time,
      timezone: "Asia/Shanghai" as const,
      status: "confirmed" as const,
      source: createBahamutReferenceSource(entry)
    }
  ];
  const primarySeason = calculatePrimarySeason(entry.uploadDate);
  const activeSeasons = calculateActiveSeasons({ schedule, fallbackPrimarySeason: primarySeason });
  const bangumiSubjectId = Number.isInteger(entry.bangumiSubjectId) ? Number(entry.bangumiSubjectId) : null;

  return {
    id: bangumiSubjectId !== null ? `anime:${bangumiSubjectId}` : `anime:bahamut:${entry.sn ?? slugify(entry.title)}`,
    title: {
      original: entry.title,
      japanese: null,
      chinese: entry.title,
      english: null,
      aliases: []
    },
    format: entry.format ?? "unknown",
    status: "airing",
    startDate: entry.uploadDate,
    endDate: null,
    datePrecision: "day",
    primarySeason,
    activeSeasons,
    updateWeekday: inferUpdateWeekday({ schedule, startDate: entry.uploadDate }),
    updateTime: beijingSlot.time,
    timezone: "Asia/Shanghai",
    episodeCount: null,
    airedEpisodeCount: null,
    isJapaneseAnime: true,
    inclusionStatus: entry.format === "tv" || entry.format === "web" ? "included" : "needs_review",
    officialUrl: null,
    coverImage: null,
    externalIds: {
      bangumiSubjectId,
      bahamutSn: entry.sn
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
    sources: [createBahamutReferenceSource(entry)],
    dataStatus: "partial",
    updatedAt: retrievedAt,
    createdAt: retrievedAt
  };
}

function taipeiTimeToBeijingDateTime(date: string, time: string): { date: string; time: string } {
  const timestamp = Date.parse(`${date}T${time}:00+08:00`);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function isBahamutReferenceEntry(value: unknown): value is BahamutReferenceEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BahamutReferenceEntry>;
  return typeof record.title === "string" && typeof record.url === "string";
}

function createParsedReferenceEntry(title: string, uploadDate: string, uploadTime: string, options: BahamutTimetableParseOptions): BahamutReferenceEntry {
  return {
    title: title.trim(),
    url: options.url ?? "bahamut:timetable",
    sn: extractSn(options.url),
    uploadDate,
    uploadTime,
    bangumiSubjectId: null,
    format: "tv",
    retrievedAt: options.retrievedAt
  };
}

function htmlToText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|td|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function extractQuotedTitle(line: string): string | null {
  const match = /[《「『](.+?)[》」』]/u.exec(line);
  return cleanTitle(match?.[1]);
}

function extractTitleAfterTime(line: string): string | null {
  const match = /(?:[01]?\d|2[0-3])[:：][0-5]?\d\s*(?:更新|上架|播出|開播|起)?\s*([^,，。;；|｜]+)/u.exec(line);
  return cleanTitle(match?.[1]);
}

function extractDateHeader(line: string, defaultYear: number): string | null {
  const match = /(?:(\d{4})[\/.-])?(\d{1,2})[\/.-](\d{1,2})(?:\s*[（(][^）)]*[）)])?/u.exec(line);
  if (!match) return null;
  const slot = toSlot(match[1], match[2], match[3], "00", "00", defaultYear);
  return slot?.date ?? null;
}

function extractTimeOnlySlot(line: string): { time: string } | null {
  const match = /(?:^|\s)([01]?\d|2[0-3])[:：]([0-5]?\d)(?:\s|$|[《「『])/u.exec(line);
  if (!match) return null;
  return {
    time: `${String(Number(match[1])).padStart(2, "0")}:${String(Number(match[2])).padStart(2, "0")}`
  };
}

function extractExplicitSlot(line: string, defaultYear: number): { date: string; time: string } | null {
  const match = /(?:(\d{4})[\/.-])?(\d{1,2})[\/.-](\d{1,2})(?:\s*[（(][^）)]*[）)])?.{0,24}?([01]?\d|2[0-3])[:：]([0-5]?\d)/u.exec(line);
  if (!match) return null;
  return toSlot(match[1], match[2], match[3], match[4], match[5], defaultYear);
}

function extractRecurringSlot(line: string, defaultYear: number): { date: string; time: string } | null {
  const match = /(?:(\d{4})[\/.-])?(\d{1,2})[\/.-](\d{1,2}).{0,32}?(?:每週|每周|每|週|周)\s*[一二三四五六日天].{0,16}?([01]?\d|2[0-3])[:：]([0-5]?\d)/u.exec(line);
  if (!match) return null;
  return toSlot(match[1], match[2], match[3], match[4], match[5], defaultYear);
}

function toSlot(year: string | undefined, month: string | undefined, day: string | undefined, hour: string | undefined, minute: string | undefined, defaultYear: number): { date: string; time: string } | null {
  if (!month || !day || !hour || !minute) return null;
  const yyyy = Number(year ?? defaultYear);
  const mm = Number(month);
  const dd = Number(day);
  const hh = Number(hour);
  const mi = Number(minute);
  if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return {
    date: `${yyyy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`,
    time: `${hh.toString().padStart(2, "0")}:${mi.toString().padStart(2, "0")}`
  };
}

function cleanTitle(value: string | undefined): string | null {
  const cleaned = value
    ?.replace(/^(更新|上架|播出|開播|動畫|節目)\s*/u, "")
    .replace(/\s*(更新|上架|播出|開播|第\d+話|第\d+集).*$/u, "")
    .trim();
  return cleaned ? cleaned : null;
}

function extractSn(url: string | undefined): string | null {
  const match = /[?&]sn=(\d+)/u.exec(url ?? "");
  return match?.[1] ?? null;
}

function dedupeReferenceEntries(entries: BahamutReferenceEntry[]): BahamutReferenceEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.title.normalize("NFKC").trim().toLowerCase()}|${entry.uploadDate ?? ""}|${entry.uploadTime ?? ""}|${entry.bangumiSubjectId ?? ""}`;
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
