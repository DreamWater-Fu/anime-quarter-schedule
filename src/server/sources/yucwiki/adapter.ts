import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isValidDateString
} from "../../anime/calculateSeason.ts";
import type { AnimeFormat, AnimeItem, AnimeSource, CoverImage, SeasonKey } from "../../types/anime.ts";
import type { AnimeSourceAdapter, SourceFetchInput, SourceFetchResult, SourceIssue } from "../types.ts";
import { inferReferenceLifecycle } from "../referenceLifecycle.ts";

export interface YucWikiEntry {
  id: string;
  pageYear?: number;
  pageSeason?: number;
  titleChinese: string | null;
  titleJapanese: string | null;
  typeText: string | null;
  tagText: string | null;
  staffText: string | null;
  broadcastText: string | null;
  broadcastExtraText: string | null;
  officialUrl: string | null;
  coverImageUrl: string | null;
  url: string;
  retrievedAt: string;
}

export interface YucWikiUnscheduledEntry {
  id: string;
  titleChinese: string | null;
  titleJapanese: string | null;
  url: string;
  retrievedAt: string;
}

export interface YucWikiAdapterOptions {
  enabled?: boolean;
  entries?: YucWikiEntry[];
  pageUrl?: string;
  pageFile?: string;
  includeAdjacentSeasonPages?: boolean;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
  rateLimitPerMinute?: number;
  now?: () => Date;
}

export interface YucWikiParseOptions {
  year: number;
  season: number;
  url: string;
  retrievedAt: string;
}

const SOURCE_NAME = "YucWiki";
const DEFAULT_BASE_URL = "https://yuc.wiki";

export class YucWikiSourceAdapter implements AnimeSourceAdapter {
  readonly name = SOURCE_NAME;
  readonly sourceType = "third_party" as const;
  readonly enabled: boolean;

  private readonly entries: YucWikiEntry[];
  private readonly pageUrl?: string;
  private readonly pageFile?: string;
  private readonly includeAdjacentSeasonPages: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly rateLimitPerMinute: number;
  private readonly now: () => Date;
  private readonly requestTimes: number[] = [];

  constructor(options: YucWikiAdapterOptions = {}) {
    this.enabled = options.enabled ?? process.env.YUCWIKI_ENABLED !== "false";
    this.entries = options.entries ?? [];
    this.pageUrl = options.pageUrl;
    this.pageFile = options.pageFile;
    this.includeAdjacentSeasonPages = options.includeAdjacentSeasonPages ??
      (options.entries === undefined && options.pageUrl === undefined && options.pageFile === undefined);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? process.env.YUCWIKI_USER_AGENT ?? "anime-quarter-schedule-local/0.1.1 (contact: local-dev)";
    this.timeoutMs = options.timeoutMs ?? parsePositiveInteger(process.env.YUCWIKI_TIMEOUT_MS, 15_000);
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? parsePositiveInteger(process.env.YUCWIKI_RATE_LIMIT_PER_MINUTE, 6);
    this.now = options.now ?? (() => new Date());
  }

  async fetchSeason(input: SourceFetchInput): Promise<SourceFetchResult> {
    const retrievedAt = this.now().toISOString();

    if (!this.enabled) {
      return {
        source: this.name,
        sourceType: this.sourceType,
        items: [],
        warnings: [{
          source: this.name,
          code: "SOURCE_DISABLED",
          message: "YucWiki adapter is disabled",
          retryable: false
        }],
        fallbackUsed: false,
        retrievedAt
      };
    }

    const warnings: SourceIssue[] = [];
    const pageEntries = await this.readCurrentAndAdjacentPageEntries(input, retrievedAt, warnings);
    const targetSeason: SeasonKey = { year: input.year, quarter: input.quarter };
    const mappedEntries = [...this.entries, ...pageEntries].map((entry) => ({
      entry,
      item: mapYucWikiEntryToAnimeItem(
        entry,
        entry.pageYear ?? input.year,
        entry.pageSeason ?? input.season,
        retrievedAt
      )
    }));
    const unscheduledEntries = mappedEntries
      .filter(({ item }) => item === null)
      .map(({ entry }) => toUnscheduledEntry(entry));
    if (unscheduledEntries.length > 0) {
      warnings.push({
        source: this.name,
        code: "MISSING_FIELD",
        message: "YucWiki entries without parseable broadcast dates were kept for old-cache inheritance",
        retryable: false,
        details: unscheduledEntries
      });
    }
    const items = mappedEntries
      .map(({ item }) => item)
      .filter((item): item is AnimeItem => item !== null)
      .filter((item) => item.primarySeason !== null && item.primarySeason.year === targetSeason.year && item.primarySeason.quarter === targetSeason.quarter);

    return {
      source: this.name,
      sourceType: this.sourceType,
      items,
      warnings,
      fallbackUsed: false,
      retrievedAt
    };
  }

  private resolvePageUrl(input: SourceFetchInput): string {
    if (this.pageUrl) return this.pageUrl;
    const envUrl = process.env.YUCWIKI_PAGE_URL;
    if (envUrl) return envUrl;
    return `${DEFAULT_BASE_URL}/${input.year}${String(input.season).padStart(2, "0")}/`;
  }

  private resolvePageFile(input: SourceFetchInput): string {
    if (this.pageFile) return this.pageFile;
    return `${process.env.DATA_DIR ?? "data"}/yucwiki-${input.year}${String(input.season).padStart(2, "0")}.html`;
  }

  private async readCurrentAndAdjacentPageEntries(
    input: SourceFetchInput,
    retrievedAt: string,
    warnings: SourceIssue[]
  ): Promise<YucWikiEntry[]> {
    const url = this.resolvePageUrl(input);
    const currentEntries = await this.readPageEntries(input, url, retrievedAt, warnings);
    if (!this.includeAdjacentSeasonPages || currentEntries.length === 0) return currentEntries;

    const adjacentWarnings: SourceIssue[] = [];
    const nextInput = getNextSeasonInput(input);
    if (!(await this.hasCachedPageFile(nextInput))) return currentEntries;
    const nextUrl = this.resolvePageUrl(nextInput);
    const nextEntries = await this.readPageEntries(nextInput, nextUrl, retrievedAt, adjacentWarnings);
    return [...currentEntries, ...nextEntries];
  }

  private async hasCachedPageFile(input: SourceFetchInput): Promise<boolean> {
    try {
      await access(resolve(/* turbopackIgnore: true */ process.cwd(), this.resolvePageFile(input)));
      return true;
    } catch {
      return false;
    }
  }

  private async readPageEntries(
    input: SourceFetchInput,
    url: string,
    retrievedAt: string,
    warnings: SourceIssue[]
  ): Promise<YucWikiEntry[]> {
    const file = this.resolvePageFile(input);
    try {
      const html = await readFile(resolve(/* turbopackIgnore: true */ process.cwd(), file), "utf8");
      return parseYucWikiHtml(html, { year: input.year, season: input.season, url: file, retrievedAt });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        warnings.push({
          source: this.name,
          code: "SOURCE_SCHEMA_CHANGED",
          message: `YucWiki cached page could not be read: ${file}`,
          retryable: false,
          details: error instanceof Error ? error.message : error
        });
      }
    }

    try {
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        warnings.push({
          source: this.name,
          code: response.status === 403 || response.status === 451 ? "SOURCE_BLOCKED" : "NETWORK_FAILED",
          message: `YucWiki page request failed with HTTP ${response.status}: ${url}`,
          retryable: response.status >= 500 || response.status === 429,
          status: response.status
        });
        return [];
      }
      const html = await response.text();
      await this.writeCachedPage(file, html, warnings);
      return parseYucWikiHtml(html, { year: input.year, season: input.season, url, retrievedAt });
    } catch (error) {
      warnings.push({
        source: this.name,
        code: "NETWORK_FAILED",
        message: `failed to fetch YucWiki page: ${url}`,
        retryable: true,
        details: error instanceof Error ? error.message : error
      });
      return [];
    }
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    await this.waitForRateLimitSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: {
          "User-Agent": this.userAgent,
          "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.7,en;q=0.5"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async writeCachedPage(file: string, html: string, warnings: SourceIssue[]): Promise<void> {
    try {
      const absoluteFile = resolve(/* turbopackIgnore: true */ process.cwd(), file);
      await mkdir(dirname(absoluteFile), { recursive: true });
      await writeFile(absoluteFile, html, "utf8");
    } catch (error) {
      warnings.push({
        source: this.name,
        code: "NETWORK_FAILED",
        message: `YucWiki cached page could not be written: ${file}`,
        retryable: false,
        details: error instanceof Error ? error.message : error
      });
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

function toUnscheduledEntry(entry: YucWikiEntry): YucWikiUnscheduledEntry {
  return {
    id: entry.id,
    titleChinese: entry.titleChinese,
    titleJapanese: entry.titleJapanese,
    url: entry.url,
    retrievedAt: entry.retrievedAt
  };
}

export function parseYucWikiHtml(html: string, options: YucWikiParseOptions): YucWikiEntry[] {
  const blocks = collectYucWikiBlocks(html);
  const entries: YucWikiEntry[] = [];

  for (const { id, anchor, block } of blocks) {
    const titleChinese = extractFirstParagraphText(block, "title_cn");
    const titleJapanese = extractFirstParagraphText(block, "title_jp");
    const title = titleJapanese ?? titleChinese;
    if (!id || !title) continue;

    entries.push({
      id,
      pageYear: options.year,
      pageSeason: options.season,
      titleChinese,
      titleJapanese,
      typeText: extractCellText(block, /<td class="type_(?!tag)[^"]*">([\s\S]*?)<\/td>/u),
      tagText: extractCellText(block, /<td class="type_tag[^"]*">([\s\S]*?)<\/td>/u),
      staffText: extractCellText(block, /<td[^>]+class="staff_[^"]*"[^>]*>([\s\S]*?)<\/td>/u),
      broadcastText: extractFirstParagraphText(block, "broadcast"),
      broadcastExtraText: extractFirstParagraphText(block, "broadcast_ex"),
      officialUrl: extractOfficialUrl(block),
      coverImageUrl: extractCoverImageUrl(block),
      url: `${options.url}#${anchor}`,
      retrievedAt: options.retrievedAt
    });
  }

  return dedupeYucWikiEntries(entries);
}

function collectYucWikiBlocks(html: string): Array<{ id: string; anchor: string; block: string }> {
  const markers = [...html.matchAll(/<!--#([A-Za-z](?:(?:\d{2})|(?:-[A-Za-z0-9]+))?)-->/gu)];
  const blocks: Array<{ id: string; anchor: string; block: string }> = [];
  const idCounts = new Map<string, number>();

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const anchor = marker[1] ?? "";
    const start = (marker.index ?? 0) + marker[0].length;
    const nextStart = markers[index + 1]?.index ?? html.length;
    const end = findYucWikiBlockEnd(html, start, nextStart);
    const id = normalizeYucWikiEntryId(anchor, idCounts);
    if (!id) continue;
    blocks.push({ id, anchor, block: html.slice(start, end) });
  }

  return blocks;
}

function normalizeYucWikiEntryId(anchor: string, idCounts: Map<string, number>): string | null {
  const normalizedAnchor = anchor.toUpperCase();
  const numbered = /^([A-Z])(\d{2})$/u.exec(normalizedAnchor);
  if (numbered?.[1] && numbered[2]) {
    idCounts.set(numbered[1], Math.max(idCounts.get(numbered[1]) ?? 0, Number(numbered[2])));
    return normalizedAnchor;
  }

  const prefix = /^([A-Z])(?:-[A-Z0-9]+)?$/u.exec(normalizedAnchor)?.[1];
  if (!prefix) return null;
  const next = (idCounts.get(prefix) ?? 0) + 1;
  idCounts.set(prefix, next);
  return `${prefix}${String(next).padStart(2, "0")}`;
}

function findYucWikiBlockEnd(html: string, start: number, fallbackEnd: number): number {
  const sectionEnd = /<p class="future_intro_|<div style="clear:both"><\/div>\s*<br>\s*<br>|<\/body>/gu;
  sectionEnd.lastIndex = start;
  const match = sectionEnd.exec(html);
  if (!match || match.index > fallbackEnd) return fallbackEnd;
  return match.index;
}

export function mapYucWikiEntryToAnimeItem(
  entry: YucWikiEntry,
  pageYear: number,
  season: number,
  fallbackRetrievedAt: string
): AnimeItem | null {
  const retrievedAt = entry.retrievedAt || fallbackRetrievedAt;
  const slot = parseYucBroadcastSlot(entry.broadcastText, pageYear, season);
  if (!slot || !isValidDateString(slot.date)) return null;

  const source = createYucWikiSource(entry);
  const startDate = slot.date;
  const schedule = [{
    episodeNumber: null,
    episodeTitle: null,
    airDate: slot.date,
    airTime: slot.time,
    timezone: "Asia/Shanghai" as const,
    status: "confirmed" as const,
    source,
    rawTimeText: [entry.broadcastText, entry.broadcastExtraText].filter(Boolean).join(" ") || null
  }];
  const primarySeason = calculatePrimarySeason(startDate);
  const lifecycle = inferReferenceLifecycle(startDate, new Date(retrievedAt));
  const isFinished = lifecycle.status === "finished";
  const format = inferYucFormat(entry);
  const titleOriginal = entry.titleJapanese ?? entry.titleChinese;
  if (!titleOriginal) return null;

  return {
    id: `anime:yucwiki:${pageYear}${String(season).padStart(2, "0")}:${entry.id.toLowerCase()}`,
    title: {
      original: titleOriginal,
      japanese: entry.titleJapanese,
      chinese: entry.titleChinese,
      english: extractEnglishAlias(entry.titleJapanese),
      aliases: collectAliases(entry)
    },
    format,
    status: lifecycle.status,
    startDate,
    endDate: lifecycle.endDate,
    datePrecision: "day",
    primarySeason,
    activeSeasons: calculateActiveSeasons({ schedule, fallbackPrimarySeason: primarySeason }),
    updateWeekday: isFinished ? null : inferUpdateWeekday({ schedule, startDate }),
    updateTime: isFinished ? null : slot.time,
    timezone: "Asia/Shanghai",
    episodeCount: parseEpisodeCount(entry.broadcastExtraText),
    airedEpisodeCount: null,
    isJapaneseAnime: true,
    inclusionStatus: format === "tv" ? "included" : "needs_review",
    officialUrl: entry.officialUrl,
    coverImage: mapYucCoverImage(entry.coverImageUrl),
    externalIds: {
      bangumiSubjectId: null,
      bahamutSn: null
    },
    bangumi: {
      subjectId: null,
      url: null,
      rating: null,
      ratingCount: null,
      rank: null,
      lastSyncedAt: null
    },
    schedule,
    staff: {
      studio: extractStudios(entry.staffText),
      productionCommittee: [],
      originalWorkType: normalizeOriginalWorkType(entry.typeText)
    },
    sources: [source],
    dataStatus: "partial",
    updatedAt: retrievedAt,
    createdAt: retrievedAt
  };
}

function createYucWikiSource(entry: YucWikiEntry): AnimeSource {
  return {
    name: SOURCE_NAME,
    type: "third_party",
    url: entry.url,
    retrievedAt: entry.retrievedAt,
    confidence: 0.9,
    scope: "japan_broadcast"
  };
}

function parseYucBroadcastSlot(value: string | null, pageYear: number, season: number): { date: string; time: string | null } | null {
  if (!value) return null;
  const normalized = htmlToText(value).normalize("NFKC");
  const dateMatches = [...normalized.matchAll(/(\d{1,2})\/(\d{1,2})/gu)];
  const dateMatch = dateMatches.find((match) => !isAdvanceStreamingDate(normalized, match.index ?? 0)) ?? dateMatches[0];
  if (!dateMatch) return null;
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  const year = season === 1 && month === 12 ? pageYear - 1 : pageYear;
  const timeMatch = /([01]?\d|2[0-3]):([0-5]\d)/u.exec(normalized);
  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    time: timeMatch ? `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}` : null
  };
}

function isAdvanceStreamingDate(value: string, index: number): boolean {
  return /(?:先行|先播|先導|提前)/u.test(value.slice(index, index + 18));
}

function inferYucFormat(entry: YucWikiEntry): AnimeFormat {
  const text = [entry.typeText, entry.tagText, entry.broadcastText, entry.broadcastExtraText].filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
  if (/剧场|劇場|映画|movie|电影|電影/u.test(text)) return "movie";
  if (/\bova\b|oad/u.test(text)) return "ova";
  if (/\bsp\b|特别篇|特別篇/u.test(text)) return "sp";
  if (/网络先行|網絡先行|配信先行/u.test(text) && !/(?:周|晚间|深夜|朝|午前|午後|\d{1,2}:\d{2})/u.test(text)) return "web";
  if (/网络放送|web|网播/u.test(text)) return "web";
  return "tv";
}

function normalizeOriginalWorkType(value: string | null): string | null {
  if (!value) return null;
  if (/原创/u.test(value)) return "original";
  if (/漫画|漫改/u.test(value)) return "manga";
  if (/小说|轻改/u.test(value)) return "novel";
  if (/游戏/u.test(value)) return "game";
  return value;
}

function parseEpisodeCount(value: string | null): number | null {
  const match = /全\s*(\d+)\s*话/u.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

function extractStudios(value: string | null): string[] {
  if (!value) return [];
  const lines = value.split(/\r?\n| {2,}/u).map((line) => line.trim()).filter(Boolean);
  const studios: string[] = [];
  for (const line of lines) {
    const match = /动画制作[:：]\s*(.+)$/u.exec(line);
    if (match?.[1]) studios.push(...match[1].split(/[、,，/]/u).map((item) => item.trim()).filter(Boolean));
  }
  return [...new Set(studios)];
}

function extractEnglishAlias(value: string | null): string | null {
  if (!value) return null;
  const slashParts = value.split("/").map((part) => part.trim());
  const english = slashParts.find((part) => /^[\p{Script=Latin}\d\s:;'",.!?&∞+\-()]+$/u.test(part));
  return english ?? null;
}

function collectAliases(entry: YucWikiEntry): string[] {
  return [
    entry.titleChinese,
    entry.titleJapanese,
    extractEnglishAlias(entry.titleJapanese)
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function mapYucCoverImage(value: string | null): CoverImage | null {
  if (!value) return null;
  return {
    large: value,
    medium: value,
    small: value,
    source: "manual"
  };
}

function extractFirstParagraphText(block: string, classPrefix: string): string | null {
  const pattern = new RegExp(`<p class="${escapeRegExp(classPrefix)}[^"]*">([\\s\\S]*?)<\\/p>`, "u");
  return cleanText(pattern.exec(block)?.[1]);
}

function extractCellText(block: string, pattern: RegExp): string | null {
  return cleanText(pattern.exec(block)?.[1]);
}

function extractOfficialUrl(block: string): string | null {
  for (const match of block.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gu)) {
    const href = decodeHtmlEntities(match[1] ?? "").trim();
    const label = htmlToText(match[2] ?? "").trim();
    if (/动画官网|動畫官網|官网|公式/u.test(label)) return href;
  }
  return null;
}

function extractCoverImageUrl(block: string): string | null {
  const match = /<img\b[^>]*(?:data-src|src)="([^"]+)"/u.exec(block);
  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : null;
}

function cleanText(value: string | undefined): string | null {
  const cleaned = htmlToText(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|td|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function dedupeYucWikiEntries(entries: YucWikiEntry[]): YucWikiEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.id}:${entry.titleJapanese ?? ""}:${entry.titleChinese ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNextSeasonInput(input: SourceFetchInput): SourceFetchInput {
  if (input.season === 10) {
    return { ...input, year: input.year + 1, season: 1, quarter: "winter" };
  }
  const nextSeason = (input.season + 3) as 4 | 7 | 10;
  return {
    ...input,
    season: nextSeason,
    quarter: nextSeason === 4 ? "spring" : nextSeason === 7 ? "summer" : "fall"
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
