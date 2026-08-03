import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { seasonMonthToQuarter } from "../../anime/calculateSeason.ts";
import type { AnimeItem, SeasonMonth } from "../../types/anime.ts";
import { DataSourceError, toSourceIssue } from "../types.ts";
import type { AnimeSourceAdapter, SourceFetchInput, SourceFetchResult, SourceIssue } from "../types.ts";
import { BangumiApiClient } from "./client.ts";
import { mapBangumiSubjectToAnimeItem } from "./mapper.ts";
import type { BangumiClient, BangumiEpisode, BangumiSubject } from "./types.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_BANGUMI_API_BASE_URL = "https://api.bgm.tv";
const DEFAULT_BANGUMI_USER_AGENT = "anime-quarter-schedule-local/0.1.1 (contact: local-dev)";
const BANGUMI_MONTH_PAGE_LIMIT = 100;

export interface BangumiAdapterOptions {
  client?: BangumiClient;
  enabled?: boolean;
  useFallbackOnFailure?: boolean;
  fallbackItems?: AnimeItem[];
  monthSubjectFallback?: (input: { year: number; month: number }) => Promise<BangumiSubject[] | null>;
  usePowerShellSubjectListFallback?: boolean;
  now?: () => Date;
}

export class BangumiSourceAdapter implements AnimeSourceAdapter {
  readonly name = "Bangumi";
  readonly sourceType = "bangumi" as const;
  readonly enabled: boolean;

  private readonly client: BangumiClient;
  private readonly useFallbackOnFailure: boolean;
  private readonly fallbackItems: AnimeItem[];
  private readonly monthSubjectFallback?: (input: { year: number; month: number }) => Promise<BangumiSubject[] | null>;
  private readonly now: () => Date;

  constructor(options: BangumiAdapterOptions = {}) {
    this.client = options.client ?? new BangumiApiClient();
    this.enabled = options.enabled ?? true;
    this.useFallbackOnFailure = options.useFallbackOnFailure ?? false;
    this.fallbackItems = options.fallbackItems ?? [];
    const usePowerShellSubjectListFallback =
      options.usePowerShellSubjectListFallback ??
      (process.platform === "win32" && process.env.BANGUMI_SUBJECT_LIST_POWERSHELL_FALLBACK !== "false");
    this.monthSubjectFallback = options.monthSubjectFallback ??
      (usePowerShellSubjectListFallback ? fetchMonthSubjectsWithPowerShell : undefined);
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
            message: "Bangumi adapter is disabled",
            retryable: false
          }
        ],
        fallbackUsed: false,
        retrievedAt
      };
    }

    const warnings: SourceIssue[] = [];

    try {
      const cachedSubjectIds = new Set<number>();
      const subjects = await this.fetchQuarterSubjects(input.year, input.season, warnings, cachedSubjectIds);
      if (subjects.length === 0) {
        throw new DataSourceError({
          source: this.name,
          code: "MISSING_FIELD",
          message: "Bangumi returned no subjects for target quarter",
          retryable: true
        });
      }

      const items: AnimeItem[] = [];
      for (const subject of subjects) {
        const item = cachedSubjectIds.has(subject.id)
          ? mapBangumiSubjectToAnimeItem(subject, [], { retrievedAt, now: this.now() })
          : await this.mapSubjectWithBestEffortEpisodes(subject, retrievedAt, warnings);
        items.push(item);
      }

      return {
        source: this.name,
        sourceType: this.sourceType,
        items,
        warnings,
        fallbackUsed: false,
        retrievedAt
      };
    } catch (error) {
      if (this.useFallbackOnFailure) {
        return {
          source: this.name,
          sourceType: this.sourceType,
          items: this.fallbackItems.length > 0 ? this.fallbackItems : createBangumiFallbackItems(input, retrievedAt),
          warnings: [toSourceIssue(this.name, error)],
          fallbackUsed: true,
          retrievedAt
        };
      }
      throw error;
    }
  }

  private async fetchQuarterSubjects(
    year: number,
    season: SeasonMonth,
    warnings: SourceIssue[],
    cachedSubjectIds: Set<number>
  ): Promise<BangumiSubject[]> {
    const months = getBangumiLookupMonths(year, season);
    const byId = new Map<number, BangumiSubject>();

    for (const { year: lookupYear, month } of months) {
      const cachedSubjects = await this.readCachedSubjects(lookupYear, month, warnings);
      if (cachedSubjects) {
        for (const subject of cachedSubjects) {
          byId.set(subject.id, subject);
          cachedSubjectIds.add(subject.id);
        }
        continue;
      }

      try {
        const subjects = await this.fetchAllMonthSubjects(lookupYear, month);
        await this.writeCachedSubjects(lookupYear, month, subjects, warnings);
        for (const subject of subjects) byId.set(subject.id, subject);
      } catch (error) {
        const fallbackSubjects = await this.tryMonthSubjectFallback(lookupYear, month, warnings);
        if (fallbackSubjects) {
          await this.writeCachedSubjects(lookupYear, month, fallbackSubjects, warnings);
          for (const subject of fallbackSubjects) {
            byId.set(subject.id, subject);
            cachedSubjectIds.add(subject.id);
          }
          continue;
        }
        warnings.push(toSourceIssue(this.name, error));
      }
    }

    if (byId.size === 0 && warnings.length > 0) {
      throw new DataSourceError({
        source: this.name,
        code: warnings.some((warning) => warning.code === "RATE_LIMITED") ? "RATE_LIMITED" : "NETWORK_FAILED",
        message: "Bangumi quarter subject list could not be fetched",
        retryable: true,
        details: warnings
      });
    }

    return [...byId.values()];
  }

  private async fetchAllMonthSubjects(year: number, month: number): Promise<BangumiSubject[]> {
    const byId = new Map<number, BangumiSubject>();
    for (let offset = 0; offset <= 1_000; offset += BANGUMI_MONTH_PAGE_LIMIT) {
      const subjects = await this.client.listSubjectsByMonth({
        year,
        month,
        limit: BANGUMI_MONTH_PAGE_LIMIT,
        offset
      });
      for (const subject of subjects) byId.set(subject.id, subject);
      if (subjects.length < BANGUMI_MONTH_PAGE_LIMIT) break;
    }
    return [...byId.values()];
  }

  private async tryMonthSubjectFallback(
    year: number,
    month: number,
    warnings: SourceIssue[]
  ): Promise<BangumiSubject[] | null> {
    if (!this.monthSubjectFallback) return null;
    try {
      return await this.monthSubjectFallback({ year, month });
    } catch (error) {
      warnings.push({
        source: this.name,
        code: "NETWORK_FAILED",
        message: `Bangumi subject list fallback failed for ${year}-${String(month).padStart(2, "0")}`,
        retryable: true,
        details: error instanceof Error ? error.message : error
      });
      return null;
    }
  }

  private async readCachedSubjects(
    year: number,
    month: number,
    warnings: SourceIssue[]
  ): Promise<BangumiSubject[] | null> {
    const file = `${process.env.DATA_DIR ?? "data"}/bangumi-${year}${String(month).padStart(2, "0")}-subjects.json`;
    try {
      const payload = JSON.parse(await readFile(resolve(/* turbopackIgnore: true */ process.cwd(), file), "utf8")) as unknown;
      return extractCachedSubjectList(payload);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
        return null;
      }
      warnings.push({
        source: this.name,
        code: "SOURCE_SCHEMA_CHANGED",
        message: `Bangumi cached subject file could not be read: ${file}`,
        retryable: false,
        details: error instanceof Error ? error.message : error
      });
      return null;
    }
  }

  private async writeCachedSubjects(
    year: number,
    month: number,
    subjects: BangumiSubject[],
    warnings: SourceIssue[]
  ): Promise<void> {
    if (subjects.length === 0) return;
    const file = `${process.env.DATA_DIR ?? "data"}/bangumi-${year}${String(month).padStart(2, "0")}-subjects.json`;
    try {
      const absoluteFile = resolve(/* turbopackIgnore: true */ process.cwd(), file);
      await mkdir(dirname(absoluteFile), { recursive: true });
      await writeFile(absoluteFile, `${JSON.stringify(subjects, null, 2)}\n`, "utf8");
    } catch (error) {
      warnings.push({
        source: this.name,
        code: "NETWORK_FAILED",
        message: `Bangumi cached subject file could not be written: ${file}`,
        retryable: false,
        details: error instanceof Error ? error.message : error
      });
    }
  }

  private async mapSubjectWithBestEffortEpisodes(
    subject: BangumiSubject,
    retrievedAt: string,
    warnings: SourceIssue[]
  ): Promise<AnimeItem> {
    let detail = subject;
    let episodes: BangumiEpisode[] = [];

    try {
      detail = await this.client.getSubject(subject.id);
    } catch (error) {
      warnings.push(toSourceIssue(this.name, error));
    }

    try {
      episodes = await this.client.getEpisodes(subject.id);
    } catch (error) {
      warnings.push(toSourceIssue(this.name, error));
    }

    return mapBangumiSubjectToAnimeItem(detail, episodes, {
      retrievedAt,
      now: this.now()
    });
  }
}

function getBangumiLookupMonths(year: number, season: SeasonMonth): Array<{ year: number; month: number }> {
  const months = season === 1 ? [12, 1, 2, 3] : [season - 1, season, season + 1, season + 2];
  return months.map((month) => ({
    year: season === 1 && month === 12 ? year - 1 : year,
    month
  }));
}

async function fetchMonthSubjectsWithPowerShell(input: { year: number; month: number }): Promise<BangumiSubject[] | null> {
  const baseUrl = (process.env.BANGUMI_API_BASE_URL ?? DEFAULT_BANGUMI_API_BASE_URL).replace(/\/$/, "");
  const userAgent = process.env.BANGUMI_USER_AGENT ?? DEFAULT_BANGUMI_USER_AGENT;
  const params = new URLSearchParams({
    type: "2",
    cat: "1",
    year: String(input.year),
    month: String(input.month),
    sort: "date",
    limit: String(BANGUMI_MONTH_PAGE_LIMIT)
  });
  const tempDir = join(tmpdir(), `bangumi-month-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const scriptFile = join(tempDir, "fetch-bangumi-month.ps1");
  const outputFile = join(tempDir, "subjects.json");
  await mkdir(tempDir, { recursive: true });
  try {
    await writeFile(
      scriptFile,
      [
        "param($baseUrl, $query, $out, $userAgent, $limit)",
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        "$headers = @{ 'User-Agent' = $userAgent; 'Accept' = 'application/json' }",
        "$items = New-Object System.Collections.Generic.List[object]",
        "$offset = 0",
        "while ($offset -le 1000) {",
        "  $uri = \"$baseUrl/v0/subjects?$query&offset=$offset\"",
        "  $response = Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 30",
        "  $payload = $response.Content | ConvertFrom-Json",
        "  $rows = @()",
        "  if ($payload -is [array]) { $rows = $payload } elseif ($payload.data) { $rows = $payload.data }",
        "  foreach ($row in $rows) { $items.Add($row) }",
        "  if ($rows.Count -lt [int]$limit) { break }",
        "  $offset += [int]$limit",
        "  Start-Sleep -Milliseconds 250",
        "}",
        "$items | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $out -Encoding UTF8",
        "[Console]::Write('200')"
      ].join("\n"),
      "utf8"
    );
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptFile,
        baseUrl,
        params.toString(),
        outputFile,
        userAgent,
        String(BANGUMI_MONTH_PAGE_LIMIT)
      ],
      {
        timeout: 40_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    );
    const payload = JSON.parse(await readFile(outputFile, "utf8")) as unknown;
    return extractCachedSubjectList(payload);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extractCachedSubjectList(payload: unknown): BangumiSubject[] {
  const rawItems = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return rawItems.filter(isCachedBangumiSubject);
}

function isCachedBangumiSubject(value: unknown): value is BangumiSubject {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger((value as { id?: unknown }).id) &&
    (value as { type?: unknown }).type === 2 &&
    typeof (value as { name?: unknown }).name === "string" &&
    ((value as { name?: string }).name?.length ?? 0) > 0
  );
}

export function createBangumiFallbackItems(input: SourceFetchInput, retrievedAt: string): AnimeItem[] {
  const quarter = input.quarter ?? seasonMonthToQuarter(input.season);
  const startDate = `${input.year}-${String(input.season).padStart(2, "0")}-01`;

  return [
    {
      id: `anime:mock-bangumi-${input.year}-${quarter}`,
      title: {
        original: `Mock Bangumi ${input.year} ${quarter}`,
        japanese: null,
        chinese: null,
        english: null,
        aliases: []
      },
      format: "unknown",
      status: "unknown",
      startDate,
      endDate: null,
      datePrecision: "day",
      primarySeason: { year: input.year, quarter },
      activeSeasons: [{ year: input.year, quarter }],
      updateWeekday: null,
      updateTime: null,
      timezone: "Asia/Tokyo",
      episodeCount: null,
      airedEpisodeCount: null,
      isJapaneseAnime: true,
      inclusionStatus: "needs_review",
      officialUrl: null,
      coverImage: null,
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
      schedule: [],
      staff: null,
      sources: [],
      dataStatus: "unverified",
      updatedAt: retrievedAt,
      createdAt: retrievedAt
    }
  ];
}
