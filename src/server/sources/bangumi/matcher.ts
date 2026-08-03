import type { AnimeFormat, AnimeItem, AnimeQuarter, AnimeSource, CoverImage } from "../../types/anime.ts";
import { isValidDateString } from "../../anime/calculateSeason.ts";
import { repairMojibakeText } from "../../anime/contentRules.ts";
import { mapBangumiPlatformToFormat } from "./mapper.ts";
import type {
  BangumiMatchResult,
  BangumiSearchClient,
  BangumiSubject,
  Candidate,
  CandidateMatchedField,
  CandidateRisk,
  MatchBangumiAnimeInput,
  MatchConfidence,
  NormalizedTitle
} from "./types.ts";

type TitleField = "original" | "japanese" | "chinese" | "english" | "alias";

interface TitleEntry {
  field: TitleField;
  raw: string;
  normalized: NormalizedTitle;
}

interface CandidateSourceFlags {
  fromSearch: boolean;
  fromSeasonMonth: boolean;
}

interface ScoredCandidate extends Candidate {
  _sourceFlags: CandidateSourceFlags;
}

const DEFAULT_OPTIONS = {
  maxSearchTitles: 8,
  maxCandidates: 12,
  highThreshold: 85,
  mediumThreshold: 65
};

const QUARTER_MONTHS: Record<AnimeQuarter, readonly number[]> = {
  winter: [1, 2, 3],
  spring: [4, 5, 6],
  summer: [7, 8, 9],
  fall: [10, 11, 12]
};

const PUNCTUATION_PATTERN =
  /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。・「」『』【】（）()［］\[\]〈〉《》！？!？：:；;，,．.〜～ー―－＝=＋+×✕]/gu;

const NOISE_PATTERNS = [
  /\b(tv\s*anime|tv\s*アニメ|anime|animation|animated|放送版|完全新作)\b/giu,
  /(?:TV)?アニメ/gu,
  /動畫|动画|動畵/gu
];

const SIMPLIFIED_TO_TRADITIONAL: Record<string, string> = {
  间: "間",
  谍: "諜",
  过: "過",
  家: "家",
  药: "藥",
  屋: "屋",
  少: "少",
  女: "女",
  的: "的",
  独: "獨",
  语: "語",
  龙: "龍",
  与: "與",
  国: "國",
  后: "後",
  发: "發",
  复: "復",
  见: "見",
  话: "話",
  总: "總",
  剧: "劇",
  场: "場"
};

const TRADITIONAL_TO_SIMPLIFIED = Object.fromEntries(
  Object.entries(SIMPLIFIED_TO_TRADITIONAL).map(([simplified, traditional]) => [traditional, simplified])
) as Record<string, string>;

export function normalizeTitle(raw: string): NormalizedTitle {
  const repaired = repairMojibakeText(raw);
  const nfkc = normalizeWhitespace(repaired.normalize("NFKC")).replace(/[A-Za-z]+/g, (value) => value.toLowerCase());
  const withoutNoise = removeNoiseWords(nfkc);
  const punctuationless = normalizeWhitespace(withoutNoise.replace(PUNCTUATION_PATTERN, " "));
  const compact = punctuationless.replace(/\s+/g, "");
  const simplified = convertCharacters(punctuationless, TRADITIONAL_TO_SIMPLIFIED);
  const traditional = convertCharacters(punctuationless, SIMPLIFIED_TO_TRADITIONAL);
  const tokens = punctuationless.split(" ").filter(Boolean);
  const seasonToken = extractSeasonToken(nfkc);

  return {
    raw,
    nfkc,
    compact,
    punctuationless,
    ...(simplified !== punctuationless ? { simplified } : {}),
    ...(traditional !== punctuationless ? { traditional } : {}),
    tokens,
    ...(seasonToken ? { seasonToken } : {})
  };
}

export function generateBangumiSearchTitles(
  input: MatchBangumiAnimeInput,
  maxTitles = DEFAULT_OPTIONS.maxSearchTitles
): string[] {
  const titles = collectInputTitleEntries(input).flatMap((entry) => {
    const normalized = entry.normalized;
    return [
      entry.raw,
      normalized.nfkc,
      normalized.punctuationless,
      normalized.simplified,
      normalized.traditional,
      stripSeasonPhrase(normalized.nfkc),
      stripParenthetical(normalized.nfkc)
    ];
  });

  return uniqueStrings(titles)
    .filter((title) => title.length > 0)
    .slice(0, maxTitles);
}

export async function matchBangumiAnime(
  input: MatchBangumiAnimeInput,
  client: BangumiSearchClient,
  options: {
    maxSearchTitles?: number;
    maxCandidates?: number;
    highThreshold?: number;
    mediumThreshold?: number;
    now?: () => Date;
  } = {}
): Promise<BangumiMatchResult> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const matchedAt = (options.now?.() ?? new Date()).toISOString();

  if (input.existingBangumiId !== null && input.existingBangumiId !== undefined) {
    const subject = await client.getSubject(input.existingBangumiId);
    const candidate = scoreBangumiCandidate(input, subject, { fromSearch: false, fromSeasonMonth: false });
    const finalized = finalizeCandidate(candidate, undefined, mergedOptions);
    return buildResult([finalized], matchedAt, mergedOptions);
  }

  const subjectsById = new Map<number, { subject: BangumiSubject; flags: CandidateSourceFlags }>();
  const searchTitles = generateBangumiSearchTitles(input, mergedOptions.maxSearchTitles);

  for (const keyword of searchTitles) {
    const subjects = await client.searchSubjects({ keyword, type: [2], limit: 10 });
    for (const subject of subjects) {
      rememberSubject(subjectsById, subject, { fromSearch: true, fromSeasonMonth: false });
    }
  }

  if (input.year !== null && input.year !== undefined && input.quarter !== null && input.quarter !== undefined) {
    for (const month of QUARTER_MONTHS[input.quarter]) {
      const subjects = await client.listSubjectsByMonth({
        year: input.year,
        month,
        type: 2,
        cat: 1,
        limit: 50
      });
      for (const subject of subjects) {
        rememberSubject(subjectsById, subject, { fromSearch: false, fromSeasonMonth: true });
      }
    }
  }

  const candidateSeeds = [...subjectsById.values()].slice(0, mergedOptions.maxCandidates);
  const detailedCandidates: ScoredCandidate[] = [];

  for (const seed of candidateSeeds) {
    let detail = seed.subject;
    try {
      detail = await client.getSubject(seed.subject.id);
    } catch {
      detail = seed.subject;
    }
    detailedCandidates.push(scoreBangumiCandidate(input, detail, seed.flags));
  }

  const sorted = detailedCandidates.sort((left, right) => right.score - left.score);
  const finalized = sorted.map((candidate, index) => finalizeCandidate(candidate, sorted[index + 1], mergedOptions));
  return buildResult(finalized, matchedAt, mergedOptions);
}

export function scoreBangumiCandidate(
  input: MatchBangumiAnimeInput,
  subject: BangumiSubject,
  sourceFlags: CandidateSourceFlags = { fromSearch: true, fromSeasonMonth: false }
): ScoredCandidate {
  const normalizedSubject = repairBangumiSubject(subject);
  const matchedFields = new Set<CandidateMatchedField>();
  const risks = new Set<CandidateRisk>();
  let score = 0;

  score += scoreTitle(input, normalizedSubject, matchedFields);
  score += scoreSeasonToken(input, normalizedSubject, matchedFields, risks);
  score += scoreDate(input, normalizedSubject, matchedFields, risks);
  score += scoreFormat(input.format ?? null, normalizedSubject, matchedFields, risks);
  score += scoreEpisodeCount(input.episodeCount ?? null, normalizedSubject, matchedFields);
  score += scoreOfficialAndStudio(input, normalizedSubject, matchedFields);
  score += sourceFlags.fromSeasonMonth ? 6 : 0;
  score += scoreSourceReliability(input.sources ?? [], risks);

  if (normalizedSubject.type !== 2) {
    score -= 30;
    risks.add("format_conflict");
  }

  const hasTitleEvidence = hasAny(matchedFields, ["name", "name_cn", "alias", "english"]);
  const hasAuxiliaryEvidence = hasAny(matchedFields, ["date", "quarter", "episodeCount", "officialUrl", "studio"]);
  if (hasTitleEvidence && matchedFields.has("name_cn") && !hasAny(matchedFields, ["name", "alias", "english"]) && !hasAuxiliaryEvidence) {
    risks.add("chinese_title_only");
  }
  if (matchedFields.has("alias") && !hasAny(matchedFields, ["name", "name_cn", "english"]) && !hasAuxiliaryEvidence) {
    risks.add("alias_only");
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const candidate: ScoredCandidate = {
    subjectId: normalizedSubject.id,
    url: `https://bgm.tv/subject/${normalizedSubject.id}`,
    name: normalizedSubject.name,
    nameCn: nonEmptyStringOrNull(normalizedSubject.name_cn),
    date: isValidDateString(normalizedSubject.date) ? normalizedSubject.date! : null,
    type: normalizedSubject.type,
    platform: nonEmptyStringOrNull(normalizedSubject.platform),
    score: clampedScore,
    confidence: confidenceFromScore(clampedScore, DEFAULT_OPTIONS),
    matchedFields: [...matchedFields],
    risks: [...risks],
    reason: "",
    subject: normalizedSubject,
    _sourceFlags: sourceFlags
  };

  return {
    ...candidate,
    reason: describeCandidate(candidate)
  };
}

export function mergeBangumiMatchIntoAnimeItem(
  item: AnimeItem,
  result: BangumiMatchResult,
  retrievedAt: string
): AnimeItem {
  if (result.confidence !== "high" || !result.selectedCandidate) {
    return {
      ...item,
      bangumi: {
        subjectId: null,
        url: null,
        rating: null,
        ratingCount: null,
        rank: null,
        lastSyncedAt: null
      },
      externalIds: {
        ...item.externalIds,
        bangumiSubjectId: null
      },
      dataStatus: item.dataStatus === "conflicting" ? "conflicting" : "unverified",
      updatedAt: retrievedAt
    };
  }

  const subject = result.selectedCandidate.subject;
  const bangumiSource: AnimeSource = {
    name: "Bangumi",
    type: "bangumi",
    url: `https://bgm.tv/subject/${subject.id}`,
    retrievedAt,
    scope: "metadata"
  };
  return {
    ...item,
    title: {
      ...item.title,
      japanese: item.title.japanese ?? subject.name,
      chinese: item.title.chinese ?? nonEmptyStringOrNull(subject.name_cn),
      aliases: uniqueStrings([...item.title.aliases, ...extractAliases(subject)])
    },
    coverImage: item.coverImage ?? mapCoverImage(subject),
    externalIds: {
      ...item.externalIds,
      bangumiSubjectId: subject.id
    },
    bangumi: {
      subjectId: subject.id,
      url: `https://bgm.tv/subject/${subject.id}`,
      rating: positiveNumberOrNull(subject.rating?.score),
      ratingCount: positiveIntegerOrNull(subject.rating?.total),
      rank: positiveIntegerOrNull(subject.rank) ?? positiveIntegerOrNull(subject.rating?.rank),
      lastSyncedAt: retrievedAt
    },
    sources: dedupeSources([...item.sources, bangumiSource]),
    updatedAt: retrievedAt
  };
}

function buildResult(
  candidates: Candidate[],
  matchedAt: string,
  options: typeof DEFAULT_OPTIONS
): BangumiMatchResult {
  const selectedCandidate = candidates[0];

  if (!selectedCandidate) {
    return {
      confidence: "low",
      score: 0,
      reason: "Bangumi search returned no candidate subjects.",
      candidates: [],
      needsManualReview: true,
      matchedAt
    };
  }

  const confidence = selectedCandidate.confidence;
  const isHigh = confidence === "high";

  return {
    ...(isHigh ? { subjectId: selectedCandidate.subjectId } : {}),
    confidence,
    score: selectedCandidate.score,
    reason: selectedCandidate.reason,
    candidates,
    needsManualReview: !isHigh,
    selectedCandidate: isHigh ? selectedCandidate : undefined,
    reviewedBy: isHigh ? "auto" : undefined,
    matchedAt
  };
}

function finalizeCandidate(
  candidate: ScoredCandidate,
  nextCandidate: ScoredCandidate | undefined,
  options: typeof DEFAULT_OPTIONS
): Candidate {
  const risks = new Set(candidate.risks);
  let score = candidate.score;

  if (nextCandidate) {
    const lead = candidate.score - nextCandidate.score;
    if (lead < 5) {
      score = Math.max(0, score - 20);
      risks.add("multiple_close_candidates");
    } else if (lead < 12) {
      score = Math.max(0, score - 10);
      risks.add("multiple_close_candidates");
    }
  }

  let confidence = confidenceFromScore(score, options);
  if ((risks.has("chinese_title_only") || risks.has("alias_only")) && score >= 45) {
    confidence = "medium";
  }
  if (candidate.type !== 2) confidence = "low";
  if (risks.has("year_mismatch") || risks.has("season_token_mismatch") || risks.has("format_conflict")) {
    confidence = "low";
  } else if (risks.has("multiple_close_candidates") || risks.has("chinese_title_only") || risks.has("alias_only")) {
    confidence = minConfidence(confidence, "medium");
  }

  const finalized: Candidate = {
    subjectId: candidate.subjectId,
    url: candidate.url,
    name: candidate.name,
    nameCn: candidate.nameCn,
    date: candidate.date,
    type: candidate.type,
    platform: candidate.platform,
    score,
    confidence,
    matchedFields: candidate.matchedFields,
    risks: [...risks],
    reason: "",
    subject: candidate.subject
  };

  return {
    ...finalized,
    reason: describeCandidate(finalized)
  };
}

function scoreTitle(
  input: MatchBangumiAnimeInput,
  subject: BangumiSubject,
  matchedFields: Set<CandidateMatchedField>
): number {
  const inputTitles = collectInputTitleEntries(input);
  const candidateTitles = collectCandidateTitleEntries(subject);
  let best = 0;
  let bestField: CandidateMatchedField | null = null;

  for (const inputTitle of inputTitles) {
    for (const candidateTitle of candidateTitles) {
      const comparison = compareTitleEntries(inputTitle, candidateTitle);
      if (comparison.score > best) {
        best = comparison.score;
        bestField = comparison.field;
      }
    }
  }

  if (bestField) matchedFields.add(bestField);
  return best;
}

function compareTitleEntries(
  input: TitleEntry,
  candidate: TitleEntry
): { score: number; field: CandidateMatchedField } {
  const candidateField = candidate.field === "alias" ? "alias" : candidate.field === "chinese" ? "name_cn" : candidate.field;
  const field = candidateField === "japanese" || candidateField === "original" ? "name" : candidateField;
  const left = titleKeys(input.normalized);
  const right = titleKeys(candidate.normalized);
  const exact = left.some((value) => right.includes(value));

  if (exact) {
    if ((input.field === "japanese" || input.field === "original") && (candidate.field === "japanese" || candidate.field === "original")) {
      return { score: input.normalized.nfkc === candidate.normalized.nfkc ? 45 : 42, field };
    }
    if (input.field === "chinese" || candidate.field === "chinese") return { score: 34, field };
    if (input.field === "alias" || candidate.field === "alias") return { score: 32, field };
    if (input.field === "english" || candidate.field === "english") return { score: 28, field: "english" };
    return { score: 42, field };
  }

  const containmentScore = scoreTitleContainment(input, candidate, field);
  if (containmentScore > 0) return { score: containmentScore, field };

  const similarity = titleSimilarity(input.normalized.punctuationless, candidate.normalized.punctuationless);
  if (similarity >= 0.82) {
    const maxFuzzy = input.normalized.tokens.length <= 2 || candidate.normalized.tokens.length <= 2 ? 24 : 32;
    return { score: Math.round(20 + (maxFuzzy - 20) * similarity), field };
  }

  return { score: 0, field };
}

function scoreTitleContainment(input: TitleEntry, candidate: TitleEntry, field: CandidateMatchedField): number {
  const leftKeys = comparableCoreTitleKeys(input.normalized);
  const rightKeys = comparableCoreTitleKeys(candidate.normalized);
  const isJapaneseTitleMatch =
    (input.field === "original" || input.field === "japanese") &&
    (candidate.field === "original" || candidate.field === "japanese");

  for (const left of leftKeys) {
    for (const right of rightKeys) {
      if (!isUsefulContainmentPair(left, right)) continue;
      if (!left.includes(right) && !right.includes(left)) continue;

      if (isJapaneseTitleMatch) {
        const coverage = Math.min(left.length, right.length) / Math.max(left.length, right.length);
        return Math.round(34 + 8 * coverage);
      }
      if (field === "alias") return 28;
      if (field === "name_cn") return 26;
    }
  }

  return 0;
}

function comparableCoreTitleKeys(title: NormalizedTitle): string[] {
  return uniqueStrings([
    title.compact,
    title.punctuationless.replace(/\s+/g, ""),
    stripSeasonPhrase(title.punctuationless).replace(/\s+/g, ""),
    stripParenthetical(title.punctuationless).replace(/\s+/g, "")
  ]).filter((key) => key.length > 0);
}

function isUsefulContainmentPair(left: string, right: string): boolean {
  const minLength = Math.min([...left].length, [...right].length);
  const maxLength = Math.max([...left].length, [...right].length);
  if (minLength >= 2 && (left.startsWith(right) || right.startsWith(left)) && hasCjkOrKana(left) && hasCjkOrKana(right)) {
    return true;
  }
  return minLength >= 3 && maxLength >= 4;
}

function hasCjkOrKana(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function scoreSeasonToken(
  input: MatchBangumiAnimeInput,
  subject: BangumiSubject,
  matchedFields: Set<CandidateMatchedField>,
  risks: Set<CandidateRisk>
): number {
  const inputToken = bestSeasonToken(collectInputTitleEntries(input));
  const candidateToken = bestSeasonToken(collectCandidateTitleEntries(subject));

  if (!inputToken && !candidateToken) return 0;
  if (inputToken && candidateToken) {
    if (inputToken.kind === candidateToken.kind && inputToken.number === candidateToken.number) {
      matchedFields.add("seasonToken");
      return inputToken.kind === "final" || inputToken.kind === "sequel" ? 4 : 12;
    }
    if (isCompatibleCourOrSeasonToken(inputToken, candidateToken)) {
      matchedFields.add("seasonToken");
      return 3;
    }
    risks.add("season_token_mismatch");
    return -20;
  }
  if (inputToken && !candidateToken && inputToken.kind === "part") return 0;
  if (inputToken && !candidateToken && inputToken.kind !== "unknown") {
    risks.add("season_token_mismatch");
    return -12;
  }
  return 0;
}

function scoreDate(
  input: MatchBangumiAnimeInput,
  subject: BangumiSubject,
  matchedFields: Set<CandidateMatchedField>,
  risks: Set<CandidateRisk>
): number {
  const subjectDate = isValidDateString(subject.date) ? subject.date! : null;
  const inputDate = input.startDate && isValidDateString(input.startDate) ? input.startDate : null;

  if (!subjectDate) {
    risks.add("date_missing");
    return 2;
  }

  if (!inputDate) {
    const subjectYear = Number(subjectDate.slice(0, 4));
    if (input.year !== null && input.year !== undefined && subjectYear !== input.year) {
      risks.add("year_mismatch");
      return -25;
    }
    if (input.year !== null && input.year !== undefined && input.quarter !== null && input.quarter !== undefined) {
      const quarter = quarterFromMonth(Number(subjectDate.slice(5, 7)));
      if (quarter === input.quarter) {
        matchedFields.add("quarter");
        return 8;
      }
    }
    return 0;
  }

  const diffDays = Math.abs(daysBetween(inputDate, subjectDate));
  if (diffDays === 0) {
    matchedFields.add("date");
    return 20;
  }
  if (diffDays <= 7) {
    matchedFields.add("date");
    return 16;
  }
  if (inputDate.slice(0, 7) === subjectDate.slice(0, 7)) {
    matchedFields.add("date");
    return 12;
  }
  const subjectYear = Number(subjectDate.slice(0, 4));
  if (input.year !== null && input.year !== undefined && subjectYear !== input.year) {
    risks.add("year_mismatch");
    return -25;
  }
  if (quarterFromMonth(Number(inputDate.slice(5, 7))) === quarterFromMonth(Number(subjectDate.slice(5, 7)))) {
    matchedFields.add("quarter");
    return 8;
  }
  if (diffDays > 90) {
    risks.add("date_conflict");
    return -18;
  }
  return 0;
}

function scoreFormat(
  inputFormat: AnimeFormat | null,
  subject: BangumiSubject,
  matchedFields: Set<CandidateMatchedField>,
  risks: Set<CandidateRisk>
): number {
  let score = subject.type === 2 ? 8 : -15;
  const candidateFormat = mapBangumiPlatformToFormat(subject.platform).format;

  if (!inputFormat || inputFormat === "unknown" || candidateFormat === "unknown") return score;
  if (inputFormat === candidateFormat) {
    matchedFields.add("format");
    return score + 5;
  }
  if (isHardFormatConflict(inputFormat, candidateFormat)) {
    risks.add("format_conflict");
    return score - 15;
  }
  return score;
}

function scoreEpisodeCount(
  inputEpisodeCount: number | null,
  subject: BangumiSubject,
  matchedFields: Set<CandidateMatchedField>
): number {
  const candidateEpisodeCount = positiveIntegerOrNull(subject.eps) ?? positiveIntegerOrNull(subject.total_episodes);
  if (inputEpisodeCount === null || candidateEpisodeCount === null) return 2;
  if (inputEpisodeCount === candidateEpisodeCount) {
    matchedFields.add("episodeCount");
    return 7;
  }
  return Math.abs(inputEpisodeCount - candidateEpisodeCount) >= 3 ? -8 : -3;
}

function scoreOfficialAndStudio(
  input: MatchBangumiAnimeInput,
  subject: BangumiSubject,
  matchedFields: Set<CandidateMatchedField>
): number {
  let score = 0;
  const officialUrls = extractOfficialUrls(subject).map(normalizeUrl);
  if (input.officialUrl && officialUrls.includes(normalizeUrl(input.officialUrl))) {
    matchedFields.add("officialUrl");
    score += 22;
  }

  const studios = extractStringListFromInfobox(subject, ["动画制作", "アニメーション制作", "制作公司", "studio"]);
  const inputStudios = (input.studios ?? []).map((value) => normalizeTitle(value).compact);
  if (studios.some((studio) => inputStudios.includes(normalizeTitle(studio).compact))) {
    matchedFields.add("studio");
    score += 4;
  }

  return score;
}

function scoreSourceReliability(sources: AnimeSource[], risks: Set<CandidateRisk>): number {
  if (sources.some((source) => source.type === "official" || source.type === "tv_station")) return 5;
  if (sources.some((source) => source.type === "ai_inferred")) {
    risks.add("weak_source");
    return -10;
  }
  if (
    sources.length > 0 &&
    sources.every((source) => source.type === "third_party" || source.type === "streaming_platform") &&
    sources.some((source) => /bahamut|巴哈|gamer|yucwiki|yuc|長門|长门/i.test(source.name))
  ) {
    risks.add("weak_source");
    return -6;
  }
  return 0;
}

function collectInputTitleEntries(input: MatchBangumiAnimeInput): TitleEntry[] {
  return uniqueTitleEntries([
    { field: "original", raw: input.title.original },
    { field: "japanese", raw: input.title.japanese ?? "" },
    { field: "chinese", raw: input.title.chinese ?? "" },
    { field: "english", raw: input.title.english ?? "" },
    ...(input.title.aliases ?? []).map((alias) => ({ field: "alias" as const, raw: alias }))
  ]);
}

function collectCandidateTitleEntries(subject: BangumiSubject): TitleEntry[] {
  return uniqueTitleEntries([
    { field: "japanese", raw: subject.name },
    { field: "chinese", raw: subject.name_cn ?? "" },
    ...extractAliases(subject).map((alias) => ({ field: "alias" as const, raw: alias }))
  ]);
}

function uniqueTitleEntries(entries: Array<{ field: TitleField; raw: string }>): TitleEntry[] {
  const seen = new Set<string>();
  const result: TitleEntry[] = [];
  for (const entry of entries) {
    const raw = entry.raw.trim();
    if (!raw) continue;
    const key = `${entry.field}:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, raw, normalized: normalizeTitle(raw) });
  }
  return result;
}

function titleKeys(title: NormalizedTitle): string[] {
  return uniqueStrings([
    title.compact,
    title.punctuationless,
    title.simplified,
    title.traditional,
    removeLeadingEnglishArticle(title.punctuationless),
    stripSeasonPhrase(title.punctuationless),
    stripParenthetical(title.punctuationless)
  ]).filter((key) => key.length > 0);
}

function bestSeasonToken(entries: TitleEntry[]): NormalizedTitle["seasonToken"] | undefined {
  return entries.find((entry) => entry.normalized.seasonToken)?.normalized.seasonToken;
}

function isCompatibleCourOrSeasonToken(
  inputToken: NonNullable<NormalizedTitle["seasonToken"]>,
  candidateToken: NonNullable<NormalizedTitle["seasonToken"]>
): boolean {
  if (inputToken.kind === "unknown" || candidateToken.kind === "unknown") return true;
  if (inputToken.kind === "part" || candidateToken.kind === "part") return true;
  if (inputToken.kind === "sequel" || candidateToken.kind === "sequel") return true;
  return inputToken.number !== undefined &&
    candidateToken.number !== undefined &&
    inputToken.number === candidateToken.number;
}

function extractSeasonToken(raw: string): NormalizedTitle["seasonToken"] | undefined {
  const value = raw.toLowerCase();
  const finalMatch = value.match(/(final\s*season|final|完结篇|完結編|完结|完結|最終章|终章|終章)/u);
  if (finalMatch) return { kind: "final", raw: finalMatch[0] };

  const partMatch = value.match(/(?:part|第)\s*([0-9]+|[一二三四五六七八九十]+)\s*(?:クール|cour|part)?/u);
  if (partMatch && /part|クール|cour/u.test(partMatch[0])) {
    return { kind: "part", number: parseNumberToken(partMatch[1]), raw: partMatch[0] };
  }

  const seasonMatch =
    value.match(/第\s*([0-9]+|[一二三四五六七八九十]+)\s*(?:季|期)/u) ??
    value.match(/(?:season|s)\s*([0-9]+)/u) ??
    value.match(/([0-9]+)(?:st|nd|rd|th)\s*season/u) ??
    value.match(/([一二三四五六七八九十]+)\s*季/u);
  if (seasonMatch) return { kind: "season", number: parseNumberToken(seasonMatch[1]), raw: seasonMatch[0] };

  const sequelMatch = value.match(/(続編|续篇|續篇|新章)/u);
  if (sequelMatch) return { kind: "sequel", raw: sequelMatch[0] };

  return undefined;
}

function stripSeasonPhrase(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/第\s*([0-9]+|[一二三四五六七八九十]+)\s*(?:季|期|クール)/giu, "")
      .replace(/(?:season|s)\s*[0-9]+/giu, "")
      .replace(/[0-9]+(?:st|nd|rd|th)\s*season/giu, "")
      .replace(/part\s*[0-9]+/giu, "")
      .replace(/完结篇|完結編|完结|完結|最終章|终章|終章|続編|续篇|續篇|新章/gu, "")
  );
}

function stripParenthetical(value: string): string {
  return normalizeWhitespace(value.replace(/[（(][^（）()]*[）)]/gu, ""));
}

function removeNoiseWords(value: string): string {
  return NOISE_PATTERNS.reduce((current, pattern) => current.replace(pattern, " "), value);
}

function removeLeadingEnglishArticle(value: string): string {
  return value.replace(/^(?:the|a|an)\s+/iu, "");
}

function parseNumberToken(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value[1] ?? ""] ?? 0);
  if (value.endsWith("十")) return (digits[value[0] ?? ""] ?? 1) * 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (digits[tens || "一"] ?? 1) * 10 + (digits[ones ?? ""] ?? 0);
  }
  return digits[value];
}

function rememberSubject(
  subjectsById: Map<number, { subject: BangumiSubject; flags: CandidateSourceFlags }>,
  subject: BangumiSubject,
  flags: CandidateSourceFlags
): void {
  const existing = subjectsById.get(subject.id);
  if (!existing) {
    subjectsById.set(subject.id, { subject, flags });
    return;
  }
  existing.flags.fromSearch ||= flags.fromSearch;
  existing.flags.fromSeasonMonth ||= flags.fromSeasonMonth;
  existing.subject = { ...existing.subject, ...subject };
}

function confidenceFromScore(score: number, options: typeof DEFAULT_OPTIONS): MatchConfidence {
  if (score >= options.highThreshold) return "high";
  if (score >= options.mediumThreshold) return "medium";
  return "low";
}

function minConfidence(left: MatchConfidence, right: MatchConfidence): MatchConfidence {
  const order: Record<MatchConfidence, number> = { low: 0, medium: 1, high: 2 };
  return order[left] <= order[right] ? left : right;
}

function describeCandidate(candidate: Pick<Candidate, "score" | "confidence" | "matchedFields" | "risks">): string {
  const matched = candidate.matchedFields.length > 0 ? candidate.matchedFields.join(", ") : "no strong fields";
  const risks = candidate.risks.length > 0 ? `; risks: ${candidate.risks.join(", ")}` : "";
  return `score ${candidate.score}, ${candidate.confidence} confidence; matched ${matched}${risks}.`;
}

function extractAliases(subject: BangumiSubject): string[] {
  return uniqueStrings([
    ...extractStringListFromInfobox(subject, ["别名", "aliases", "Alias"]),
    ...extractStringListFromInfobox(subject, ["英文名", "English"])
  ]).filter((alias) => alias !== subject.name && alias !== subject.name_cn);
}

function extractOfficialUrls(subject: BangumiSubject): string[] {
  return extractStringListFromInfobox(subject, ["官方网站", "官网", "公式サイト", "Official website"]);
}

function extractStringListFromInfobox(subject: BangumiSubject, keys: string[]): string[] {
  if (!Array.isArray(subject.infobox)) return [];
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  const result: string[] = [];

  for (const item of subject.infobox) {
    const key = item.key?.toLowerCase();
    if (!key || !normalizedKeys.has(key)) continue;
    result.push(...unknownToStrings(item.value));
  }

  return uniqueStrings(result.map((value) => value.trim()).filter(Boolean));
}

function unknownToStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(unknownToStrings);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.v === "string") return [record.v];
    if (typeof record.value === "string") return [record.value];
  }
  return [];
}

function mapCoverImage(subject: BangumiSubject): CoverImage | null {
  const images = subject.images;
  if (!images) return null;
  return {
    large: images.large ?? images.common ?? null,
    medium: images.medium ?? images.common ?? null,
    small: images.small ?? images.grid ?? null,
    source: "bangumi"
  };
}

function isHardFormatConflict(input: AnimeFormat, candidate: AnimeFormat): boolean {
  const tvLike = new Set<AnimeFormat>(["tv", "web"]);
  const specialLike = new Set<AnimeFormat>(["movie", "sp", "ova", "recap", "pv", "cm", "music_video"]);
  return (tvLike.has(input) && specialLike.has(candidate)) || (specialLike.has(input) && tvLike.has(candidate));
}

function quarterFromMonth(month: number): AnimeQuarter {
  if (month <= 3) return "winter";
  if (month <= 6) return "spring";
  if (month <= 9) return "summer";
  return "fall";
}

function daysBetween(left: string, right: string): number {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Math.round((rightTime - leftTime) / 86_400_000);
}

function titleSimilarity(left: string, right: string): number {
  if (left.length === 0 || right.length === 0) return 0;
  const distance = levenshteinDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function levenshteinDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length]!;
}

function convertCharacters(value: string, map: Record<string, string>): string {
  return [...value].map((char) => map[char] ?? char).join("");
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, "").toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()))];
}

function repairBangumiSubject(subject: BangumiSubject): BangumiSubject {
  return repairMojibakeValue(subject) as BangumiSubject;
}

function repairMojibakeValue(value: unknown): unknown {
  if (typeof value === "string") return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairMojibakeValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = repairMojibakeValue(nested);
    }
    return result;
  }
  return value;
}

function dedupeSources(sources: AnimeSource[]): AnimeSource[] {
  const seen = new Set<string>();
  const result: AnimeSource[] = [];
  for (const source of sources) {
    const key = `${source.name}:${source.type}:${source.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function hasAny<T>(set: Set<T>, values: T[]): boolean {
  return values.some((value) => set.has(value));
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
