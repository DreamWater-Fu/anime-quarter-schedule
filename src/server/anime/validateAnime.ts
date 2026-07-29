import type {
  AnimeCache,
  AnimeItem,
  AnimeQuarter,
  AnimeSource,
  DataSourceType,
  DataStatus,
  ScheduleStatus
} from "../types/anime.ts";
import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  dedupeSeasonKeys,
  isIsoDateTimeString,
  isValidDateString,
  isValidTimeString,
  seasonKeyEquals
} from "./calculateSeason.ts";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  severity: ValidationSeverity;
}

const VALID_QUARTERS = new Set<AnimeQuarter>(["winter", "spring", "summer", "fall"]);
const VALID_SOURCE_TYPES = new Set<DataSourceType>([
  "official",
  "tv_station",
  "streaming_platform",
  "bangumi",
  "third_party",
  "ai_inferred",
  "manual"
]);
const VALID_SCHEDULE_STATUSES = new Set<ScheduleStatus>([
  "confirmed",
  "tentative",
  "changed",
  "delayed",
  "unknown"
]);
const VALID_DATA_STATUSES = new Set<DataStatus>(["complete", "partial", "conflicting", "unverified"]);
const VALID_TIMEZONES = new Set(["Asia/Tokyo", "Asia/Shanghai"]);

function issue(path: string, code: string, message: string, severity: ValidationSeverity = "error"): ValidationIssue {
  return { path, code, message, severity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNullableDate(value: unknown, path: string): ValidationIssue[] {
  if (value === null) return [];
  return isValidDateString(value)
    ? []
    : [issue(path, "INVALID_DATE", "date must be null or a real YYYY-MM-DD date")];
}

function validateNullableIso(value: unknown, path: string): ValidationIssue[] {
  if (value === null) return [];
  return isIsoDateTimeString(value)
    ? []
    : [issue(path, "INVALID_ISO_DATETIME", "datetime must be null or an ISO 8601 string")];
}

function validateNullableTime(value: unknown, path: string): ValidationIssue[] {
  if (value === null) return [];
  return isValidTimeString(value)
    ? []
    : [issue(path, "INVALID_TIME", "time must be null or HH:mm in 00:00-23:59 range")];
}

function validateSeasonKey(value: unknown, path: string): ValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(path, "INVALID_SEASON_KEY", "season key must be an object")];
  }

  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(value.year)) {
    issues.push(issue(`${path}.year`, "INVALID_YEAR", "year must be a number"));
  }
  if (typeof value.quarter !== "string" || !VALID_QUARTERS.has(value.quarter as AnimeQuarter)) {
    issues.push(issue(`${path}.quarter`, "INVALID_QUARTER", "quarter must be winter, spring, summer or fall"));
  }
  return issues;
}

function validateSource(source: unknown, path: string): ValidationIssue[] {
  if (!isRecord(source)) return [issue(path, "INVALID_SOURCE", "source must be an object")];

  const issues: ValidationIssue[] = [];
  if (typeof source.name !== "string" || source.name.trim() === "") {
    issues.push(issue(`${path}.name`, "MISSING_SOURCE_NAME", "source name is required"));
  }
  if (typeof source.type !== "string" || !VALID_SOURCE_TYPES.has(source.type as DataSourceType)) {
    issues.push(issue(`${path}.type`, "INVALID_SOURCE_TYPE", "source type is invalid"));
  }
  if (!isIsoDateTimeString(source.retrievedAt)) {
    issues.push(issue(`${path}.retrievedAt`, "INVALID_SOURCE_RETRIEVED_AT", "source retrievedAt must be ISO 8601"));
  }
  if (source.type === "ai_inferred") {
    if (typeof source.confidence !== "number" || source.confidence < 0 || source.confidence > 1) {
      issues.push(issue(`${path}.confidence`, "MISSING_AI_CONFIDENCE", "ai_inferred source requires confidence 0-1"));
    }
  }

  return issues;
}

export function isExpectedBangumiRatingGap(item: Pick<AnimeItem, "bangumi">): boolean {
  return item.bangumi.rating === null && item.bangumi.subjectId !== null;
}

function validateBangumi(item: AnimeItem): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bangumi = item.bangumi;

  if (bangumi.subjectId !== null && !Number.isInteger(bangumi.subjectId)) {
    issues.push(issue("bangumi.subjectId", "INVALID_BANGUMI_SUBJECT_ID", "Bangumi subjectId must be a number or null"));
  }

  if (bangumi.url !== null) {
    const subjectId = bangumi.subjectId;
    const expectedUrl = Number.isInteger(subjectId) ? `https://bgm.tv/subject/${subjectId}` : null;
    if (typeof bangumi.url !== "string" || (expectedUrl !== null && bangumi.url !== expectedUrl)) {
      issues.push(issue("bangumi.url", "INVALID_BANGUMI_URL", "Bangumi URL must match subjectId or be null"));
    }
  }

  if (bangumi.rating === null && !isExpectedBangumiRatingGap(item)) {
    issues.push(issue("bangumi.rating", "MISSING_BANGUMI_RATING", "Bangumi rating is missing", "warning"));
  } else if (bangumi.rating !== null && (typeof bangumi.rating !== "number" || bangumi.rating <= 0)) {
    issues.push(issue("bangumi.rating", "INVALID_BANGUMI_RATING", "Bangumi rating must be a positive number or null"));
  }

  for (const key of ["ratingCount", "rank"] as const) {
    const value: number | null = bangumi[key];
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      issues.push(issue(`bangumi.${key}`, `INVALID_BANGUMI_${key.toUpperCase()}`, `${key} must be a positive number or null`));
    }
  }

  issues.push(...validateNullableIso(bangumi.lastSyncedAt, "bangumi.lastSyncedAt"));

  return issues;
}

export function validateAnimeItem(item: AnimeItem): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof item.id !== "string" || item.id.trim() === "") {
    issues.push(issue("id", "MISSING_ID", "anime id is required"));
  }
  if (!item.title || typeof item.title.original !== "string" || item.title.original.trim() === "") {
    issues.push(issue("title.original", "MISSING_TITLE", "title.original is required"));
  }
  if (!Array.isArray(item.title?.aliases)) {
    issues.push(issue("title.aliases", "INVALID_ALIASES", "title.aliases must be an array"));
  }

  issues.push(...validateNullableDate(item.startDate, "startDate"));
  issues.push(...validateNullableDate(item.endDate, "endDate"));
  issues.push(...validateNullableTime(item.updateTime, "updateTime"));
  issues.push(...validateBangumi(item));

  if (!VALID_TIMEZONES.has(item.timezone)) {
    issues.push(issue("timezone", "INVALID_TIMEZONE", "anime timezone must be Asia/Tokyo or Asia/Shanghai"));
  }
  if (item.isJapaneseAnime === false && item.inclusionStatus !== "excluded") {
    issues.push(issue("inclusionStatus", "NON_JAPANESE_NOT_EXCLUDED", "non-Japanese anime must be excluded"));
  }
  if (item.updateWeekday !== null && (!Number.isInteger(item.updateWeekday) || item.updateWeekday < 1 || item.updateWeekday > 7)) {
    issues.push(issue("updateWeekday", "INVALID_WEEKDAY", "updateWeekday must be 1-7 or null"));
  }
  if (!VALID_DATA_STATUSES.has(item.dataStatus)) {
    issues.push(issue("dataStatus", "INVALID_DATA_STATUS", "dataStatus is invalid"));
  }
  if (item.inclusionStatus === "excluded" && (!item.exclusionReason || item.exclusionReason.trim() === "")) {
    issues.push(issue("exclusionReason", "MISSING_EXCLUSION_REASON", "excluded anime must include exclusionReason"));
  }
  if (
    item.episodeCount !== null &&
    item.airedEpisodeCount !== null &&
    item.airedEpisodeCount > item.episodeCount
  ) {
    issues.push(issue("airedEpisodeCount", "AIRED_EPISODES_OVER_TOTAL", "airedEpisodeCount cannot exceed episodeCount"));
  }

  if (item.primarySeason === null) {
    if (item.startDate !== null) {
      issues.push(issue("primarySeason", "MISSING_PRIMARY_SEASON", "primarySeason must be calculated from startDate"));
    }
  } else {
    issues.push(...validateSeasonKey(item.primarySeason, "primarySeason"));
    if (item.startDate === null) {
      issues.push(issue("primarySeason", "PRIMARY_WITHOUT_START_DATE", "primarySeason must be null when startDate is null"));
    } else if (isValidDateString(item.startDate)) {
      const expectedPrimarySeason = calculatePrimarySeason(item.startDate);
      if (!seasonKeyEquals(item.primarySeason, expectedPrimarySeason)) {
        issues.push(issue("primarySeason", "PRIMARY_SEASON_MISMATCH", "primarySeason must be derived from startDate"));
      }
    }
  }

  if (!Array.isArray(item.activeSeasons)) {
    issues.push(issue("activeSeasons", "INVALID_ACTIVE_SEASONS", "activeSeasons must be an array"));
  } else {
    item.activeSeasons.forEach((season, index) => {
      issues.push(...validateSeasonKey(season, `activeSeasons.${index}`));
    });

    const deduped = dedupeSeasonKeys(item.activeSeasons);
    if (deduped.length !== item.activeSeasons.length) {
      issues.push(issue("activeSeasons", "DUPLICATE_ACTIVE_SEASON", "activeSeasons must be unique"));
    }
  }

  if (!Array.isArray(item.schedule)) {
    issues.push(issue("schedule", "INVALID_SCHEDULE", "schedule must be an array"));
  } else {
    item.schedule.forEach((scheduleItem, index) => {
      const path = `schedule.${index}`;
      if (!isValidDateString(scheduleItem.airDate)) {
        issues.push(issue(`${path}.airDate`, "INVALID_AIR_DATE", "schedule airDate must be YYYY-MM-DD"));
      }
      issues.push(...validateNullableTime(scheduleItem.airTime, `${path}.airTime`));
      if (!VALID_TIMEZONES.has(scheduleItem.timezone)) {
        issues.push(issue(`${path}.timezone`, "INVALID_SCHEDULE_TIMEZONE", "schedule timezone must be Asia/Tokyo or Asia/Shanghai"));
      }
      if (!VALID_SCHEDULE_STATUSES.has(scheduleItem.status)) {
        issues.push(issue(`${path}.status`, "INVALID_SCHEDULE_STATUS", "schedule status is invalid"));
      }
      if (scheduleItem.source) {
        issues.push(...validateSource(scheduleItem.source, `${path}.source`));
      }
    });

    const scheduleDatesAreValid = item.schedule.every((scheduleItem) => isValidDateString(scheduleItem.airDate));
    if (scheduleDatesAreValid && Array.isArray(item.activeSeasons)) {
      const expectedActiveSeasons = calculateActiveSeasons({
        schedule: item.schedule,
        fallbackPrimarySeason: item.primarySeason
      });
      const sameLength = expectedActiveSeasons.length === item.activeSeasons.length;
      const sameValues = sameLength && expectedActiveSeasons.every((season, index) => seasonKeyEquals(season, item.activeSeasons[index]));

      if (!sameValues) {
        issues.push(issue("activeSeasons", "ACTIVE_SEASONS_MISMATCH", "activeSeasons must come from schedule airDate coverage"));
      }
    }
  }

  if (!Array.isArray(item.sources)) {
    issues.push(issue("sources", "INVALID_SOURCES", "sources must be an array"));
  } else if (item.inclusionStatus !== "excluded" && item.sources.length === 0) {
    issues.push(issue("sources", "MISSING_SOURCES", "included anime must keep at least one source"));
  } else {
    item.sources.forEach((source: AnimeSource, index: number) => {
      issues.push(...validateSource(source, `sources.${index}`));
    });
  }

  issues.push(...validateNullableIso(item.updatedAt, "updatedAt"));
  issues.push(...validateNullableIso(item.createdAt, "createdAt"));

  if (item.dataStatus === "complete") {
    if (item.startDate === null || item.schedule.length === 0) {
      issues.push(
        issue(
          "dataStatus",
          "COMPLETE_WITH_MISSING_KEY_FIELDS",
          "complete dataStatus requires startDate and schedule",
          "warning"
        )
      );
    }
  }

  return issues;
}

export function validateAnimeCache(cache: AnimeCache): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (cache.schemaVersion !== 1) {
    issues.push(issue("schemaVersion", "INVALID_SCHEMA_VERSION", "schemaVersion must be 1"));
  }
  issues.push(...validateNullableIso(cache.updatedAt, "updatedAt"));
  if (!["manual-update", "manual-edit", "migration"].includes(cache.generatedBy)) {
    issues.push(issue("generatedBy", "INVALID_GENERATED_BY", "generatedBy is invalid"));
  }
  if (!Array.isArray(cache.items)) {
    return [...issues, issue("items", "INVALID_ITEMS", "items must be an array")];
  }

  const ids = new Set<string>();
  cache.items.forEach((item, index) => {
    if (ids.has(item.id)) {
      issues.push(issue(`items.${index}.id`, "DUPLICATE_ID", `duplicate anime id: ${item.id}`));
    }
    ids.add(item.id);

    for (const itemIssue of validateAnimeItem(item)) {
      issues.push({ ...itemIssue, path: `items.${index}.${itemIssue.path}` });
    }
  });

  return issues;
}

export function hasBlockingValidationIssues(issues: ValidationIssue[]): boolean {
  return issues.some((item) => item.severity === "error");
}
