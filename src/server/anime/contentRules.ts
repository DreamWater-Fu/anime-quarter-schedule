export const MAX_INCLUDED_SEASON_NUMBER = 10;

const FOREIGN_TITLE_PATTERNS = [
  /中国之旅|国产|国创|大陆|台湾|香港/iu,
  /皮皮鲁|鲁西西|天才小鲁班|新西游|千秋诗颂|敦煌的故事|山海(?:精奇|传奇)/iu,
  /喜羊羊|灰太狼|猪猪侠|熊出没|熊熊帮帮团|大头儿子|小头爸爸|棉花糖和云朵妈妈/iu,
  /超变兽车侠|铠兽超人|传奇少年刘伯温|进化先锋|旋风战车队|篮球旋风|冰球旋风|爆裂飞车/iu,
  /节气密码|宁德山海|少年家国梦|书香少年|王应麟|幸福公寓|光影天炎战甲|青田小田鱼|孔子归来|飞越五千年|霸王龙雷奇|桃花夫人|快乐小郑星/iu,
  /龙族|龍族|Dragon\s+Raja/iu,
  /차징|탑스피너|티니핑|꼬마버스|타요|라바|爆笑虫子|小公交车太友|朱迪希猜谜秀/iu,
  /south\s+park|paw\s+patrol|curtis|柯蒂斯总统|ninjago|lego|mickey|disney|miraculous|family\s+guy/iu,
  /marvel|iron\s*man|spider-?man|spidey|moon\s*girl|devil\s*dinosaur|superman|beast\s*boy|dc\s*metal/iu,
  /transformers|变形金刚|變形金剛|rick\s*and\s*morty|瑞克和莫蒂|瑞克和莫蒂/iu,
  /sponge\s*bob|spongebob|海绵宝宝|海綿寶寶|patrick\s*star|派大星/iu,
  /paddington|帕丁顿熊|帕丁頓熊|octonauts|海底小纵队|海底小縱隊|wild\s*kratts|动物兄弟|動物兄弟/iu,
  /ghost\s+and\s+molly\s+mcgee|幽灵与莫莉|幽靈與莫莉|beyblade\s+burst\s+quadstrike/iu,
  /star\s*trek|星际迷航|星際迷航|blood\s+of\s+zeus|宙斯之血|smiling\s+friends|微笑朋友/iu,
  /smurfs?|schtroumpfs|蓝精灵|藍精靈|mermaid\s+magic|魔法美人鱼|blaze\s+and\s+the\s+monster\s+machines/iu,
  /sealook|pinkfong|baby\s*shark|grimsburg|wakfu|沃土|monster\s*high|怪物高中|primal|genndy\s+tartakovsky|samuel|nyaaaanvy/iu
];

const FOREIGN_METADATA_PATTERNS = [
  /^中国$/iu,
  /^中国大陆$/iu,
  /^国产$/iu,
  /^国创$/iu,
  /^国产动画$/iu,
  /^中国动画$/iu,
  /^大陆动画$/iu,
  /^台湾动画$/iu,
  /^香港动画$/iu,
  /^美国$/iu,
  /^美国动画$/iu,
  /^欧美$/iu,
  /^欧美动画$/iu,
  /^英国$/iu,
  /^英国动画$/iu,
  /^法国$/iu,
  /^法国动画$/iu,
  /^加拿大$/iu,
  /^加拿大动画$/iu,
  /^韩国$/iu,
  /^韩产$/iu,
  /^韩国动画$/iu,
  /^韩产动画$/iu,
  /中国动画|国产动画|欧美动画|美国动画|法国动画|加拿大动画|韩国动画|韩产动画/iu
];

const THEATRICAL_MOVIE_PATTERN = /剧场版|劇場版|映画|movie|the\s+movie|film|电影|電影/iu;
const KNOWN_NON_TV_SPECIAL_PATTERN = /テラパゴスのキラキラ探検記|太乐巴戈斯的闪闪发亮探险记|太樂巴戈斯的閃閃發亮探險記|terapagos/iu;
const SEASON_NUMBER_PATTERN =
  /(?:第\s*([0-9０-９一二三四五六七八九十百]+)\s*(?:[季期部]|シリーズ))|(?:season|series|s)\s*([0-9０-９]+)/giu;

export function hasExplicitNonJapaneseSignal(values: Array<string | null | undefined>): boolean {
  const normalizedValues = toNormalizedValues(values);
  return FOREIGN_TITLE_PATTERNS.some((pattern) => normalizedValues.some((value) => pattern.test(value)));
}

export function hasExplicitNonJapaneseMetadataSignal(values: Array<string | null | undefined>): boolean {
  const normalizedValues = toNormalizedValues(values);
  const hasForeignSignal = FOREIGN_METADATA_PATTERNS.some((pattern) => normalizedValues.some((value) => pattern.test(value)));
  if (!hasForeignSignal) return false;
  return !hasStrongJapaneseProductionSignal(normalizedValues);
}

export function hasForeignPrimaryTitleSignal(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = normalizeContentText(value);
  return /[\uac00-\ud7af]/u.test(normalized) && !/[ぁ-ゖァ-ヺー]/u.test(normalized);
}

export function hasTheatricalMovieSignal(values: Array<string | null | undefined>): boolean {
  return THEATRICAL_MOVIE_PATTERN.test(toNormalizedHaystack(values));
}

export function hasKnownNonTvSpecialSignal(values: Array<string | null | undefined>): boolean {
  return KNOWN_NON_TV_SPECIAL_PATTERN.test(toNormalizedHaystack(values));
}

export function hasOverSeasonLimitSignal(values: Array<string | null | undefined>): boolean {
  const haystack = toNormalizedHaystack(values);
  for (const match of haystack.matchAll(SEASON_NUMBER_PATTERN)) {
    const seasonNumber = parseSeasonNumber(match[1] ?? match[2] ?? "");
    if (seasonNumber !== null && seasonNumber > MAX_INCLUDED_SEASON_NUMBER) return true;
  }
  return false;
}

export function normalizeContentText(value: string): string {
  return repairMojibakeText(value).normalize("NFKC").trim().toLowerCase();
}

export function repairMojibakeText(value: string): string {
  if (!looksLikeUtf8AsLatin1(value)) return value;

  const repaired = Buffer.from(value, "latin1").toString("utf8");
  return scoreMojibake(repaired) < scoreMojibake(value) ? repaired : value;
}

function toNormalizedHaystack(values: Array<string | null | undefined>): string {
  return toNormalizedValues(values).join(" ");
}

function toNormalizedValues(values: Array<string | null | undefined>): string[] {
  return values
    .filter((value): value is string => typeof value === "string")
    .map(normalizeContentText)
    .filter(Boolean);
}

function hasStrongJapaneseProductionSignal(values: string[]): boolean {
  return values.some((value) =>
    /日本动画|日本動畫|日本アニメ|japanese\s+animation|japan\s+animation|tokyo\s+mx|テレビ|テレ東|テレビ東京|nhk|bs11|at-x|toei|東映|aniplex|yostar\s*pictures/iu.test(value) ||
    /[ぁ-ゖァ-ヺー]/u.test(value)
  );
}

function parseSeasonNumber(value: string): number | null {
  const normalized = value.normalize("NFKC").trim();
  if (/^\d+$/u.test(normalized)) return Number(normalized);

  const digitByChar: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (normalized === "十") return 10;
  if (normalized.startsWith("十")) return 10 + (digitByChar[normalized[1] ?? ""] ?? 0);
  if (normalized.endsWith("十")) return (digitByChar[normalized[0] ?? ""] ?? 1) * 10;
  if (normalized.includes("十")) {
    const [tens, ones] = normalized.split("十");
    return (digitByChar[tens || "一"] ?? 1) * 10 + (digitByChar[ones ?? ""] ?? 0);
  }
  return digitByChar[normalized] ?? null;
}

function looksLikeUtf8AsLatin1(value: string): boolean {
  return /[\u00c3\u00e3\u00c2\u00c5\u00e6\u00e7\u00e8\u00e9\u00e5\u00e4\u00f0\u00fe]|[\u0080-\u009f]/u.test(value);
}

function scoreMojibake(value: string): number {
  const markerCount = (value.match(/[\u00c3\u00e3\u00c2\u00c5\u00e6\u00e7\u00e8\u00e9\u00e5\u00e4\u00f0\u00fe]|[\u0080-\u009f]/gu) ?? []).length;
  const replacementCount = (value.match(/\uFFFD/gu) ?? []).length;
  return markerCount + replacementCount * 3;
}
