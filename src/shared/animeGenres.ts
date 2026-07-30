export const animeGenreOptions = [
  "恋爱",
  "热血",
  "搞笑",
  "日常",
  "奇幻",
  "异世界",
  "战斗",
  "冒险",
  "校园",
  "科幻",
  "悬疑",
  "运动",
  "音乐",
  "治愈",
  "百合",
  "BL",
  "子供向"
] as const;

export type AnimeGenreTag = (typeof animeGenreOptions)[number];

export const animeGenreLabels: Record<AnimeGenreTag, string> = Object.fromEntries(
  animeGenreOptions.map((genre) => [genre, genre])
) as Record<AnimeGenreTag, string>;

const genreKeywords: Record<AnimeGenreTag, string[]> = {
  恋爱: ["恋爱", "戀愛", "爱情", "愛情", "恋愛", "romance", "love", "ラブコメ"],
  热血: ["热血", "熱血", "少年", "王道", "燃", "shonen", "shounen"],
  搞笑: ["搞笑", "喜剧", "喜劇", "コメディ", "comedy"],
  日常: ["日常", "生活", "slice of life"],
  奇幻: ["奇幻", "魔法", "魔女", "魔王", "魔术", "魔術", "妖精", "ファンタジー", "fantasy"],
  异世界: ["异世界", "異世界", "转生", "轉生", "転生", "isekai", "reincarnation"],
  战斗: ["战斗", "戰鬥", "格斗", "格鬥", "バトル", "battle", "动作", "動作", "action", "剑", "劍", "剣", "刀", "忍者", "战争", "戰爭"],
  冒险: ["冒险", "冒険", "adventure"],
  校园: ["校园", "校園", "学园", "學園", "学校", "學校", "高校", "中学", "中學", "school"],
  科幻: ["科幻", "sci-fi", "science fiction", "机战", "機戰", "机器人", "機器人", "ロボット"],
  悬疑: ["悬疑", "懸疑", "推理", "侦探", "偵探", "ミステリー", "mystery", "suspense"],
  运动: ["运动", "運動", "体育", "體育", "スポーツ", "sports"],
  音乐: ["音乐", "音樂", "歌", "偶像", "アイドル", "music"],
  治愈: ["治愈", "治癒", "癒し", "healing"],
  百合: ["百合", "ガールズラブ", "girls love"],
  BL: ["耽美", "轻bl", "輕bl", "boys love", "ボーイズラブ"],
  子供向: ["子供向", "儿童", "兒童", "kids"]
};

export function normalizeAnimeGenreTags(values: Iterable<string | null | undefined>): AnimeGenreTag[] {
  const haystack = [...values]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.normalize("NFKC").toLowerCase());

  return animeGenreOptions.filter((genre) =>
    genreKeywords[genre].some((keyword) => {
      const normalizedKeyword = keyword.normalize("NFKC").toLowerCase();
      return haystack.some((value) => matchesKeyword(value, normalizedKeyword));
    })
  );
}

export function mergeAnimeGenreTags(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined
): AnimeGenreTag[] {
  return normalizeAnimeGenreTags([...(left ?? []), ...(right ?? [])]);
}

function matchesKeyword(value: string, keyword: string): boolean {
  if (/^[a-z0-9][a-z0-9+\-\s]*$/i.test(keyword)) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(keyword)}([^a-z0-9]|$)`, "i");
    return pattern.test(value);
  }
  return value.includes(keyword);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
