import { setTimeout as delay } from "node:timers/promises";

import { DataSourceError } from "../types.ts";
import type { BangumiClient, BangumiEpisode, BangumiSubject } from "./types.ts";

export interface BangumiApiClientOptions {
  baseUrl?: string;
  userAgent?: string;
  accessToken?: string;
  timeoutMs?: number;
  rateLimitPerMinute?: number;
  fetchImpl?: typeof fetch;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "https://api.bgm.tv";
const DEFAULT_USER_AGENT = "anime-quarter-schedule-local/0.1.0 (contact: local-dev)";

export class BangumiApiClient implements BangumiClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;
  private readonly rateLimitPerMinute: number;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimes: number[] = [];

  constructor(options: BangumiApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.BANGUMI_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.userAgent = options.userAgent ?? process.env.BANGUMI_USER_AGENT ?? DEFAULT_USER_AGENT;
    this.accessToken = options.accessToken ?? process.env.BANGUMI_ACCESS_TOKEN;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? Number(process.env.BANGUMI_RATE_LIMIT_PER_MINUTE ?? 30);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listSubjectsByMonth(input: {
    year: number;
    month: number;
    type?: 2;
    cat?: 1;
    limit?: number;
    offset?: number;
  }): Promise<BangumiSubject[]> {
    const params = new URLSearchParams({
      type: String(input.type ?? 2),
      cat: String(input.cat ?? 1),
      year: String(input.year),
      month: String(input.month),
      sort: "date",
      limit: String(input.limit ?? 50),
      offset: String(input.offset ?? 0)
    });
    const payload = await this.request<unknown>(`/v0/subjects?${params.toString()}`);
    return extractSubjectList(payload);
  }

  async searchSubjects(input: { keyword: string; type?: 2[]; limit?: number }): Promise<BangumiSubject[]> {
    const payload = await this.request<unknown>("/v0/search/subjects", {
      method: "POST",
      body: JSON.stringify({
        keyword: input.keyword,
        filter: { type: input.type ?? [2] },
        limit: input.limit ?? 10
      })
    });
    return extractSubjectList(payload);
  }

  async getSubject(subjectId: number): Promise<BangumiSubject> {
    const payload = await this.request<unknown>(`/v0/subjects/${subjectId}`);
    if (!isBangumiSubject(payload)) {
      throw new DataSourceError({
        source: "Bangumi",
        code: "SOURCE_SCHEMA_CHANGED",
        message: "Bangumi subject detail schema changed",
        retryable: false,
        details: payload
      });
    }
    return payload;
  }

  async getEpisodes(subjectId: number): Promise<BangumiEpisode[]> {
    const params = new URLSearchParams({ subject_id: String(subjectId), type: "0" });
    const payload = await this.request<unknown>(`/v0/episodes?${params.toString()}`);
    if (Array.isArray(payload)) return payload.filter(isRecord);
    if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
    throw new DataSourceError({
      source: "Bangumi",
      code: "SOURCE_SCHEMA_CHANGED",
      message: "Bangumi episodes schema changed",
      retryable: false,
      details: payload
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    await this.waitForRateLimitSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("User-Agent", this.userAgent);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
    } catch (error) {
      throw new DataSourceError({
        source: "Bangumi",
        code: "NETWORK_FAILED",
        message:
          error instanceof Error && error.name === "AbortError"
            ? "Bangumi API request timed out"
            : "Bangumi API network request failed",
        retryable: true,
        details: error instanceof Error ? error.message : error
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new DataSourceError({
        source: "Bangumi",
        code: "RATE_LIMITED",
        message: "Bangumi API rate limit reached",
        retryable: true,
        status: response.status
      });
    }

    if (!response.ok) {
      throw new DataSourceError({
        source: "Bangumi",
        code: "API_ERROR",
        message: `Bangumi API returned HTTP ${response.status}`,
        retryable: response.status >= 500,
        status: response.status
      });
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new DataSourceError({
        source: "Bangumi",
        code: "SOURCE_SCHEMA_CHANGED",
        message: "Bangumi API returned invalid JSON",
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

function extractSubjectList(payload: unknown): BangumiSubject[] {
  if (Array.isArray(payload)) return payload.filter(isBangumiSubject);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isBangumiSubject);

  throw new DataSourceError({
    source: "Bangumi",
    code: "SOURCE_SCHEMA_CHANGED",
    message: "Bangumi subject list schema changed",
    retryable: false,
    details: payload
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBangumiSubject(value: unknown): value is BangumiSubject {
  return (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    value.type === 2 &&
    typeof value.name === "string" &&
    value.name.length > 0
  );
}
