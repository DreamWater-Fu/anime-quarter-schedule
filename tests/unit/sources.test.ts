import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { validateAnimeItem } from "../../src/server/anime/index.ts";
import {
  BahamutSourceAdapter,
  BangumiApiClient,
  BangumiSourceAdapter,
  DataSourceError,
  mapBangumiSubjectToAnimeItem,
  mapBahamutReferenceToAnimeItem,
  mapYourAnimesReferenceToAnimeItem,
  mapYucWikiEntryToAnimeItem,
  parseBahamutTimetableText,
  parseYourAnimesHtml,
  parseYucWikiHtml,
  YucWikiSourceAdapter,
  YourAnimesSourceAdapter
} from "../../src/server/sources/index.ts";
import type { BangumiClient, BangumiSubject } from "../../src/server/sources/index.ts";

const retrievedAt = "2026-07-28T12:00:00+09:00";

const subject: BangumiSubject = {
  id: 2001,
  type: 2,
  name: "Example Anime",
  name_cn: "示例动画",
  date: "2026-07-03",
  platform: "TV",
  eps: 2,
  total_episodes: 2,
  rating: {
    score: 0,
    total: 0,
    rank: 0
  },
  images: {
    large: "https://img.example/large.jpg",
    medium: "https://img.example/medium.jpg",
    small: "https://img.example/small.jpg"
  },
  infobox: [
    { key: "别名", value: [{ v: "Example Alias" }] },
    { key: "官方网站", value: "https://anime.example/" }
  ]
};

describe("Bangumi mapper", () => {
  it("maps Bangumi subject and episodes to the unified AnimeItem model", () => {
    const item = mapBangumiSubjectToAnimeItem(
      subject,
      [
        { ep: 1, name_cn: "第一话", airdate: "2026-07-03", type: 0 },
        { ep: 2, name_cn: "第二话", airdate: "2026-07-10", type: 0 },
        { ep: 3, name_cn: "SP", airdate: "2026-07-17", type: 1 }
      ],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.id, "anime:2001");
    assert.equal(item.title.chinese, "示例动画");
    assert.deepEqual(item.title.aliases, ["Example Alias"]);
    assert.equal(item.format, "tv");
    assert.deepEqual(item.primarySeason, { year: 2026, quarter: "summer" });
    assert.deepEqual(item.activeSeasons, [{ year: 2026, quarter: "summer" }]);
    assert.equal(item.updateWeekday, 5);
    assert.equal(item.updateTime, null);
    assert.equal(item.bangumi.subjectId, 2001);
    assert.equal(item.bangumi.rating, null);
    assert.equal(item.bangumi.ratingCount, null);
    assert.equal(item.bangumi.rank, null);
    assert.equal(item.officialUrl, "https://anime.example/");
    assert.equal(item.coverImage?.source, "bangumi");
    assert.equal(item.schedule.length, 2);
    assert.equal(item.dataStatus, "complete");

    const blockingIssues = validateAnimeItem(item).filter((issue) => issue.severity === "error");
    assert.deepEqual(blockingIssues, []);
  });

  it("repairs UTF-8 text that was decoded as Latin-1 before mapping titles", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 2002,
        name: "\u00e3\u0083\u00a1\u00e3\u0083\u0080\u00e3\u0083\u00aa\u00e3\u0082\u00b9\u00e3\u0083\u0088",
        name_cn: "\u00e9\u0087\u0091\u00e7\u0089\u008c\u00e5\u00be\u0097\u00e4\u00b8\u00bb",
        infobox: [
          { key: "Alias", value: [{ v: "\u00e3\u0083\u00a1\u00e3\u0083\u0080\u00e3\u0083\u00aa\u00e3\u0082\u00b9\u00e3\u0083\u0088" }] }
        ]
      },
      [{ ep: 1, name_cn: "\u00e7\u00ac\u00ac\u00e4\u00b8\u0080\u00e8\u00af\u009d", airdate: "2025-01-04", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.title.original, "メダリスト");
    assert.equal(item.title.japanese, "メダリスト");
    assert.equal(item.title.chinese, "金牌得主");
    assert.deepEqual(item.title.aliases, []);
    assert.equal(item.schedule[0]?.episodeTitle, "第一话");
  });

  it("does not write airedEpisodeCount greater than episodeCount when Bangumi counts conflict", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        eps: 1,
        total_episodes: 3
      },
      [
        { ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 },
        { ep: 2, name_cn: "Episode 2", airdate: "2026-07-10", type: 0 }
      ],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.episodeCount, null);
    assert.equal(item.airedEpisodeCount, 2);
    assert.equal(item.dataStatus, "partial");

    const blockingIssues = validateAnimeItem(item).filter((issue) => issue.severity === "error");
    assert.deepEqual(blockingIssues, []);
  });

  it("marks explicit non-Japanese Bangumi subjects as excluded", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3001,
        name: "Ninjago: Dragons Rising Season 4",
        name_cn: "乐高幻影忍者：神龙崛起 第四季",
        platform: "TV",
        infobox: [{ key: "官方网站", value: "https://kids.lego.com/en-us/ninjago" }]
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.isJapaneseAnime, false);
    assert.equal(item.inclusionStatus, "excluded");
    assert.equal(item.exclusionReason, "Not Japanese anime");
  });

  it("keeps Japanese productions even when Chinese aliases contain robot franchise terms", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 472386,
        name: "シンカリオン チェンジ ザ ワールド",
        name_cn: "进化先锋 改变世界",
        date: "2024-04-07",
        platform: "TV",
        rating: { score: 6.3, total: 120, rank: 0 },
        infobox: [
          { key: "别名", value: [{ v: "新干线变形机器人 进化先锋 改变世界" }] },
          { key: "动画制作", value: "SIGNAL.MD＆Production I.G" },
          { key: "官方网站", value: "https://www.shinkalion.com/" }
        ]
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2024-04-07", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.isJapaneseAnime, true);
    assert.equal(item.inclusionStatus, "included");
    assert.equal(item.format, "tv");
  });

  it("excludes Paw Patrol and Curtis President as non-Japanese subjects", () => {
    for (const input of [
      { name: "PAW Patrol Season 13", name_cn: "汪汪队立大功 第十三季" },
      { name: "柯蒂斯总统", name_cn: "柯蒂斯总统" },
      { name: "冰球旋风 第2季", name_cn: "冰球旋风 第2季" },
      { name: "幸福公寓", name_cn: "幸福公寓" },
      { name: "Miraculous Ladybug Season 6", name_cn: "瓢虫雷迪 第六季" },
      { name: "Mickey Mouse Clubhouse+", name_cn: "米奇妙妙屋+" },
      { name: "Transformers: Earthspark Season 4", name_cn: "变形金刚:地球火种 第四季" },
      { name: "Primal Season 3", name_cn: "史前战纪 第三季" },
      { name: "熊熊帮帮团5", name_cn: "熊熊帮帮团 第5季" },
      { name: "Family Guy Season 24", name_cn: "恶搞之家 第二十四季" },
      { name: "Spidey and His Amazing Friends Season 5", name_cn: "蜘蛛侠与他的神奇朋友们 第五季" },
      { name: "SEALOOK 2nd season", name_cn: "SEALOOK 2nd season" },
      { name: "Rick and Morty Season 8", name_cn: "瑞克和莫蒂 第八季" },
      { name: "Rick and Morty: THE ANIME", name_cn: "瑞克和莫蒂：THE ANIME" },
      { name: "Transformers: Earthspark Season 4", name_cn: "变形金刚：地球火种 第四季" },
      { name: "Dragon Raja", name_cn: "龍族" },
      { name: "The Patrick Star Show Season 3", name_cn: "派大星秀 第三季" },
      { name: "皮皮鲁和鲁西西地球之钟奇遇记3", name_cn: "皮皮鲁和鲁西西地球之钟奇遇记3" },
      { name: "천재 샤오루반", name_cn: "天才小鲁班" },
      { name: "新西游历险记", name_cn: "新西游历险记" },
      { name: "라바 스핀오프 - 라바 인 마스", name_cn: "爆笑虫子之火星冒险" },
      { name: "Grimsburg", name_cn: "Grimsburg" },
      { name: "千秋诗颂 第一季", name_cn: "千秋诗颂 第一季" },
      { name: "꼬마버스 타요 7기", name_cn: "小公交车太友 第七季" },
      { name: "敦煌的故事", name_cn: "敦煌的故事" },
      { name: "Wakfu Season 4", name_cn: "沃土 第四季" },
      { name: "Moon Girl and Devil Dinosaur Season 2", name_cn: "月亮女孩与恶魔恐龙 第二季" },
      { name: "山海精奇", name_cn: "山海精奇" },
      { name: "Samuel", name_cn: "Samuel" },
      { name: "Nyaaaanvy", name_cn: "Nyaaaanvy" },
      { name: "The Adventures of Paddington Season 3", name_cn: "帕丁顿熊的冒险之旅 第三季" },
      { name: "Beyblade Burst QuadStrike", name_cn: "Beyblade Burst QuadStrike" },
      { name: "The Ghost and Molly McGee Season 2", name_cn: "幽灵与莫莉 第二季" },
      { name: "The Octonauts Season8", name_cn: "海底小纵队 第8季" },
      { name: "Wild Kratts Season 7", name_cn: "动物兄弟 第七季" },
      { name: "Monster High Season 2", name_cn: "怪物高中：新世代 第二季" }
    ]) {
      const item = mapBangumiSubjectToAnimeItem(
        {
          ...subject,
          id: 3100,
          name: input.name,
          name_cn: input.name_cn,
          platform: "TV",
          infobox: []
        },
        [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
        { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
      );

      assert.equal(item.isJapaneseAnime, false, input.name);
      assert.equal(item.inclusionStatus, "excluded", input.name);
    }
  });

  it("excludes titles above season ten and theatrical movies", () => {
    const excludedInputs = [
      { name: "Yamishibai 11", name_cn: "暗芝居 第十一季", reason: "Season number exceeds 10" },
      { name: "Nintama Rantarou Series 32", name_cn: "忍者乱太郎 第32季", reason: "Season number exceeds 10" },
      { name: "おじゃる丸 第26シリーズ", name_cn: "", reason: "Season number exceeds 10" },
      { name: "Example Anime Movie", name_cn: "示例动画 剧场版", reason: "Theatrical movie" },
      { name: "テラパゴスのキラキラ探検記", name_cn: "太乐巴戈斯的闪闪发亮探险记", reason: "Non-TV special" }
    ];

    for (const input of excludedInputs) {
      const item = mapBangumiSubjectToAnimeItem(
        {
          ...subject,
          id: 3200,
          name: input.name,
          name_cn: input.name_cn,
          platform: "TV",
          infobox: []
        },
        [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
        { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
      );

      assert.equal(item.inclusionStatus, "excluded");
      assert.equal(item.exclusionReason, input.reason);
    }

    const tenthSeason = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3201,
        name: "Allowed Season 10",
        name_cn: "允许保留 第十季",
        platform: "TV",
        infobox: []
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(tenthSeason.inclusionStatus, "included");
  });

  it("uses Bangumi tags and primary title script to reject non-Japanese animation without deleting Japanese Korean-source adaptations", () => {
    const taggedChineseSubject = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3250,
        name: "节气密码",
        name_cn: "节气密码",
        platform: "TV",
        tags: [{ name: "中国" }, { name: "TV" }],
        infobox: []
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2024-10-30", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );
    assert.equal(taggedChineseSubject.isJapaneseAnime, false);
    assert.equal(taggedChineseSubject.inclusionStatus, "excluded");

    const hangulPrimaryTitle = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3251,
        name: "슈팅스타 캐치! 티니핑",
        name_cn: "闪耀流星 奇妙!萌可",
        platform: "TV",
        tags: [{ name: "TV" }],
        infobox: []
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2024-10-10", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );
    assert.equal(hangulPrimaryTitle.isJapaneseAnime, false);
    assert.equal(hangulPrimaryTitle.inclusionStatus, "excluded");

    const japaneseKoreanSourceAdaptation = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3252,
        name: "俺だけレベルアップな件",
        name_cn: "我独自升级",
        platform: "TV",
        tags: [{ name: "韩国" }, { name: "韩漫" }, { name: "A-1Pictures" }, { name: "TV" }],
        infobox: [{ key: "官方网站", value: "https://sololeveling-anime.net/" }]
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2024-01-06", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );
    assert.equal(japaneseKoreanSourceAdaptation.isJapaneseAnime, true);
    assert.equal(japaneseKoreanSourceAdaptation.inclusionStatus, "included");

    const arknightsJapaneseProduction = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3253,
        name: "アークナイツ【冬隠帰路/PERISH IN FROST】",
        name_cn: "明日方舟：冬隐归路",
        platform: "TV",
        tags: [{ name: "国产" }, { name: "中国" }, { name: "日本动画" }, { name: "YostarPictures" }],
        infobox: [
          { key: "官方网站", value: "https://arknights-anime.jp/" },
          { key: "播放电视台", value: "テレビ東京" }
        ]
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2023-10-06", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );
    assert.equal(arknightsJapaneseProduction.isJapaneseAnime, true);
    assert.equal(arknightsJapaneseProduction.inclusionStatus, "included");
  });

  it("excludes NSFW and explicit adult subjects", () => {
    for (const input of [
      { name: "Adult Test Anime", name_cn: "成人动画", nsfw: true },
      { name: "Seminar Classmate", name_cn: "同一个研讨会的染谷同学是AV女优的事", nsfw: false }
    ]) {
      const item = mapBangumiSubjectToAnimeItem(
        {
          ...subject,
          id: 3200,
          name: input.name,
          name_cn: input.name_cn,
          platform: "TV",
          nsfw: input.nsfw,
          infobox: []
        },
        [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
        { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
      );

      assert.equal(item.isJapaneseAnime, false);
      assert.equal(item.inclusionStatus, "excluded");
    }
  });

  it("keeps a started show airing while its inferred end date is still in the future", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        eps: 3,
        total_episodes: 3
      },
      [
        { ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 },
        { ep: 2, name_cn: "Episode 2", airdate: "2026-08-10", type: 0 },
        { ep: 3, name_cn: "Episode 3", airdate: "2026-09-10", type: 0 }
      ],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.status, "airing");
    assert.equal(item.endDate, "2026-09-10");
  });

  it("infers finished state for historical cached Bangumi list subjects with episode counts", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3300,
        date: "2025-07-19",
        eps: 11,
        total_episodes: 11
      },
      [],
      { retrievedAt, now: new Date("2026-07-29T00:00:00Z") }
    );

    assert.equal(item.endDate, "2025-09-27");
    assert.equal(item.status, "finished");
  });

  it("marks stale historical seasonal subjects finished even when episode count is missing", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3301,
        date: "2025-07-15",
        eps: 0,
        total_episodes: 0
      },
      [],
      { retrievedAt, now: new Date("2026-07-29T00:00:00Z") }
    );

    assert.equal(item.endDate, "2025-09-30");
    assert.equal(item.status, "finished");
  });
});

describe("Bangumi API client", () => {
  it("sets a clear User-Agent and maps HTTP 429 to RATE_LIMITED", async () => {
    let userAgent = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      userAgent = new Headers(init?.headers).get("User-Agent") ?? "";
      return new Response("{}", { status: 429 });
    };

    const client = new BangumiApiClient({
      fetchImpl,
      userAgent: "anime-quarter-test/0.1",
      rateLimitPerMinute: 0
    });

    await assert.rejects(
      () => client.listSubjectsByMonth({ year: 2026, month: 7 }),
      (error) => error instanceof DataSourceError && error.code === "RATE_LIMITED"
    );
    assert.equal(userAgent, "anime-quarter-test/0.1");
  });

  it("reports subject list schema changes", async () => {
    const client = new BangumiApiClient({
      fetchImpl: async () => Response.json({ unexpected: true }),
      rateLimitPerMinute: 0
    });

    await assert.rejects(
      () => client.listSubjectsByMonth({ year: 2026, month: 7 }),
      (error) => error instanceof DataSourceError && error.code === "SOURCE_SCHEMA_CHANGED"
    );
  });

  it("falls back to a configured GET fetch when the primary Bangumi fetch fails", async () => {
    let fallbackUrl = "";
    const client = new BangumiApiClient({
      fetchImpl: async () => {
        throw new TypeError("connect timeout");
      },
      fallbackFetchImpl: async (url) => {
        fallbackUrl = String(url);
        return Response.json({ data: [subject] });
      },
      usePowerShellFallback: false,
      rateLimitPerMinute: 0
    });

    const result = await client.listSubjectsByMonth({ year: 2025, month: 7, limit: 1 });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, subject.id);
    assert.match(fallbackUrl, /year=2025/);
    assert.match(fallbackUrl, /month=7/);
  });

  it("falls back to a configured POST fetch for Bangumi search requests", async () => {
    let fallbackMethod = "";
    let fallbackBody = "";
    let contentType = "";
    const client = new BangumiApiClient({
      fetchImpl: async () => {
        throw new TypeError("connect timeout");
      },
      fallbackFetchImpl: async (_url, init) => {
        fallbackMethod = init?.method ?? "";
        fallbackBody = String(init?.body ?? "");
        contentType = new Headers(init?.headers).get("Content-Type") ?? "";
        return Response.json({ data: [subject] });
      },
      usePowerShellFallback: false,
      rateLimitPerMinute: 0
    });

    const result = await client.searchSubjects({ keyword: "葬送のフリーレン", type: [2], limit: 1 });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, subject.id);
    assert.equal(fallbackMethod, "POST");
    assert.match(contentType, /application\/json/);
    assert.match(fallbackBody, /葬送のフリーレン/);
  });
});

describe("source adapters", () => {
  it("parses YucWiki season pages into primary catalog rows", () => {
    const html = `
      <!--#A01-->
      <div style="float:left"><img width="180px" data-src="https://example.test/cover.jpg"></div>
      <div><table><tr><td class="title_main_r" colspan="2" rowspan="2">
      <p class="title_cn_r">示例长门标题</p>
      <p class="title_jp_r">サンプルユック</p></td>
      <td class="type_a_r">原创动画</td></tr>
      <tr><td class="type_tag_r">青春/恋爱</td></tr><tr>
      <td rowspan="2" class="staff_r">动画制作：Sample Studio</td>
      <td rowspan="2" class="cast_r">样例声优</td>
      <td class="link_a_r">
      <a href="https://sample.example/" target="_blank">动画官网</a>
      <p class="broadcast_r">7/5周日深夜</p>
      <p class="broadcast_ex_r">(全12话)</p></td></tr>
      <tr><td class="link_b_r"></td></tr></table></div>
      <p class="future_intro_"><b>*动态漫不再详细介绍</b></p>
    `;
    const entries = parseYucWikiHtml(html, {
      year: 2026,
      season: 7,
      url: "https://yuc.wiki/202607/",
      retrievedAt
    });
    const item = mapYucWikiEntryToAnimeItem(entries[0]!, 2026, 7, retrievedAt);

    assert.equal(entries.length, 1);
    assert.equal(item?.title.original, "サンプルユック");
    assert.equal(item?.title.chinese, "示例长门标题");
    assert.equal(item?.format, "tv");
    assert.equal(item?.startDate, "2026-07-05");
    assert.equal(item?.episodeCount, 12);
    assert.equal(item?.officialUrl, "https://sample.example/");
    assert.equal(item?.staff?.studio[0], "Sample Studio");
    assert.equal(item?.sources[0]?.name, "YucWiki");
    assert.equal(item?.sources[0]?.scope, "japan_broadcast");
  });

  it("parses YucWiki priority markers as separate catalog rows", () => {
    const html = `
      <!--#B-P3-->
      <div><table><tr><td class="title_main_r">
      <p class="title_cn_r">First Priority Title</p>
      <p class="title_jp_r">First Priority Title JP</p></td>
      <td class="type_a_r">original tv anime</td></tr>
      <tr><td class="link_a_r"><p class="broadcast_r">4/1</p></td></tr></table></div>
      <div style="clear:both"></div>
      <!--#B-P3-->
      <div><table><tr><td class="title_main_r">
      <p class="title_cn_r">Second Priority Title</p>
      <p class="title_jp_r">Second Priority Title JP</p></td>
      <td class="type_a_r">original tv anime</td></tr>
      <tr><td class="link_a_r"><p class="broadcast_r">4/2</p></td></tr></table></div>
      <div style="clear:both"></div>
    `;

    const entries = parseYucWikiHtml(html, {
      year: 2023,
      season: 4,
      url: "https://yuc.wiki/202304/",
      retrievedAt
    });

    assert.deepEqual(entries.map((entry) => entry.id), ["B01", "B02"]);
    assert.deepEqual(entries.map((entry) => entry.titleChinese), ["First Priority Title", "Second Priority Title"]);
  });

  it("normalizes lowercase YucWiki markers before assigning catalog row IDs", () => {
    const html = `
      <!--#a01-->
      <div><table><tr><td class="title_main_r">
      <p class="title_cn_r">Lowercase Marker Title</p>
      <p class="title_jp_r">Lowercase Marker Title JP</p></td>
      <td class="type_a_r">original tv anime</td></tr>
      <tr><td class="link_a_r"><p class="broadcast_r">1/12</p></td></tr></table></div>
      <div style="clear:both"></div>
    `;

    const entries = parseYucWikiHtml(html, {
      year: 2021,
      season: 1,
      url: "https://yuc.wiki/202101/",
      retrievedAt
    });

    assert.deepEqual(entries.map((entry) => entry.id), ["A01"]);
    assert.equal(entries[0]?.titleChinese, "Lowercase Marker Title");
  });

  it("prefers regular YucWiki broadcast dates over advance streaming dates", () => {
    const html = `
      <!--#B01-->
      <div><table><tr><td class="title_main_r">
      <p class="title_cn_r">躲在超市后门抽烟的两人</p>
      <p class="title_jp_r">スーパーの裏でヤニ吸うふたり</p></td>
      <td class="type_b_r">漫画改编动画</td></tr>
      <tr><td class="link_a_r"><p class="broadcast_r">6/3先行6话<br>7/9周四深夜</p></td></tr></table></div>
      <div style="clear:both"></div>
    `;

    const entries = parseYucWikiHtml(html, {
      year: 2026,
      season: 7,
      url: "https://yuc.wiki/202607/",
      retrievedAt
    });
    const item = mapYucWikiEntryToAnimeItem(entries[0]!, 2026, 7, retrievedAt);

    assert.equal(item?.format, "tv");
    assert.equal(item?.startDate, "2026-07-09");
    assert.deepEqual(item?.primarySeason, { year: 2026, quarter: "summer" });
  });

  it("treats YucWiki entries with only advance streaming dates as web", () => {
    const html = `
      <!--#B01-->
      <div><table><tr><td class="title_main_r">
      <p class="title_cn_r">村井之恋</p>
      <p class="title_jp_r">村井の恋</p></td>
      <td class="type_b_r">漫画改编动画</td></tr>
      <tr><td class="link_a_r"><p class="broadcast_r">9/4网络先行</p></td></tr></table></div>
      <div style="clear:both"></div>
    `;

    const entries = parseYucWikiHtml(html, {
      year: 2024,
      season: 10,
      url: "https://yuc.wiki/202410/",
      retrievedAt
    });
    const item = mapYucWikiEntryToAnimeItem(entries[0]!, 2024, 10, retrievedAt);

    assert.equal(item?.format, "web");
    assert.equal(item?.startDate, "2024-09-04");
  });

  it("reads the next YucWiki page to recover entries whose premiere belongs to the requested season", async () => {
    const previousDataDir = process.env.DATA_DIR;
    const dataDir = await mkdtemp(join(tmpdir(), "yucwiki-adjacent-"));
    process.env.DATA_DIR = dataDir;
    await writeFile(join(dataDir, "yucwiki-202010.html"), `
      <!--#A01-->
      <div><table><tr><td class="title_main_r">
      <p class="title_cn_r">当前秋季标题</p>
      <p class="title_jp_r">Current Fall Title</p></td>
      <td class="type_a_r">原创动画</td></tr>
      <tr><td class="link_a_r"><p class="broadcast_r">10/1周四深夜</p></td></tr></table></div>
      <div style="clear:both"></div>
    `);
    await writeFile(join(dataDir, "yucwiki-202101.html"), `
      <!--#B01-->
      <div><table><tr><td class="title_main_r">
      <p class="title_cn_r">进击的巨人 最终季</p>
      <p class="title_jp_r">進撃の巨人 The Final Season</p></td>
      <td class="type_b_r">漫画改编动画</td></tr>
      <tr><td rowspan="2" class="staff_r">动画制作：MAPPA</td>
      <td class="link_a_r"><p class="broadcast_r">12/6周日深夜</p></td></tr></table></div>
      <div style="clear:both"></div>
    `);

    try {
      const adapter = new YucWikiSourceAdapter({ now: () => new Date(retrievedAt), rateLimitPerMinute: 0 });
      const result = await adapter.fetchSeason({ year: 2020, season: 10, quarter: "fall" });

      assert.equal(result.items.some((item) => item.title.chinese === "当前秋季标题"), true);
      const adjacentItem = result.items.find((item) => item.title.chinese === "进击的巨人 最终季");
      assert.equal(adjacentItem?.startDate, "2020-12-06");
      assert.equal(adjacentItem?.id, "anime:yucwiki:202101:b01");
      assert.deepEqual(adjacentItem?.primarySeason, { year: 2020, quarter: "fall" });
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses Bangumi fallback data when configured and the source fails", async () => {
    const previousDataDir = process.env.DATA_DIR;
    const dataDir = await mkdtemp(join(tmpdir(), "bangumi-fallback-"));
    process.env.DATA_DIR = dataDir;
    const failingClient: BangumiClient = {
      listSubjectsByMonth: async () => {
        throw new DataSourceError({
          source: "Bangumi",
          code: "NETWORK_FAILED",
          message: "offline",
          retryable: true
        });
      },
      searchSubjects: async () => [],
      getSubject: async () => {
        throw new Error("unused");
      },
      getEpisodes: async () => []
    };

    try {
      const adapter = new BangumiSourceAdapter({
        client: failingClient,
        useFallbackOnFailure: true,
        usePowerShellSubjectListFallback: false,
        now: () => new Date(retrievedAt)
      });
      const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

      assert.equal(result.fallbackUsed, true);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.bangumi.subjectId, null);
      assert.equal(result.items[0]?.dataStatus, "unverified");
      assert.equal(result.warnings[0]?.code, "NETWORK_FAILED");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
    }
  });

  it("uses Bangumi month subject fallback before reporting quarter list failure", async () => {
    const previousDataDir = process.env.DATA_DIR;
    const dataDir = await mkdtemp(join(tmpdir(), "missing-bangumi-cache-"));
    process.env.DATA_DIR = dataDir;
    const failingClient: BangumiClient = {
      listSubjectsByMonth: async () => {
        throw new DataSourceError({
          source: "Bangumi",
          code: "NETWORK_FAILED",
          message: "offline",
          retryable: true
        });
      },
      searchSubjects: async () => [],
      getSubject: async () => {
        throw new Error("unused");
      },
      getEpisodes: async () => {
        throw new Error("unused");
      }
    };
    const adapter = new BangumiSourceAdapter({
      client: failingClient,
      monthSubjectFallback: async ({ month }) => (month === 7 ? [subject] : []),
      now: () => new Date(retrievedAt)
    });

    try {
      const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.id, "anime:2001");
      assert.equal(result.items[0]?.bangumi.subjectId, 2001);
      assert.equal(result.warnings.some((warning) => warning.message === "Bangumi quarter subject list could not be fetched"), false);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
    }
  });

  it("writes fetched Bangumi month subjects to the local snapshot cache", async () => {
    const previousDataDir = process.env.DATA_DIR;
    const dataDir = await mkdtemp(join(tmpdir(), "bangumi-cache-"));
    process.env.DATA_DIR = dataDir;
    const client: BangumiClient = {
      listSubjectsByMonth: async ({ month }) => (month === 7 ? [subject] : []),
      searchSubjects: async () => [],
      getSubject: async (subjectId) => ({ ...subject, id: subjectId }),
      getEpisodes: async () => []
    };
    const adapter = new BangumiSourceAdapter({
      client,
      monthSubjectFallback: async () => null,
      now: () => new Date(retrievedAt)
    });

    try {
      const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });
      const cached = JSON.parse(await readFile(join(dataDir, "bangumi-202507-subjects.json"), "utf8")) as unknown[];

      assert.equal(result.items.length, 1);
      assert.equal(cached.length, 1);
      assert.equal((cached[0] as { id?: unknown }).id, subject.id);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
    }
  });

  it("reads Bangumi month snapshot files that include a UTF-8 BOM", async () => {
    const previousDataDir = process.env.DATA_DIR;
    const dataDir = await mkdtemp(join(tmpdir(), "bangumi-bom-cache-"));
    process.env.DATA_DIR = dataDir;
    const client: BangumiClient = {
      listSubjectsByMonth: async () => {
        throw new Error("cached month files should be used");
      },
      searchSubjects: async () => [],
      getSubject: async () => {
        throw new Error("unused");
      },
      getEpisodes: async () => []
    };
    const adapter = new BangumiSourceAdapter({
      client,
      monthSubjectFallback: async () => null,
      now: () => new Date(retrievedAt)
    });

    try {
      await writeFile(join(dataDir, "bangumi-202506-subjects.json"), "\uFEFF[]\n", "utf8");
      await writeFile(join(dataDir, "bangumi-202507-subjects.json"), `\uFEFF${JSON.stringify([subject], null, 2)}\n`, "utf8");
      await writeFile(join(dataDir, "bangumi-202508-subjects.json"), "\uFEFF[]\n", "utf8");
      await writeFile(join(dataDir, "bangumi-202509-subjects.json"), "\uFEFF[]\n", "utf8");

      const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.bangumi.subjectId, subject.id);
      assert.equal(result.warnings.length, 0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
    }
  });

  it("can explicitly disable Bahamut as a reference-only source", async () => {
    const adapter = new BahamutSourceAdapter({ enabled: false });
    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 0);
    assert.equal(result.warnings[0]?.code, "SOURCE_DISABLED");
  });

  it("enables Bahamut by default when no environment override is set", async () => {
    const adapter = new BahamutSourceAdapter({
      referencesPath: "tests/fixtures/missing-bahamut-references.json",
      timetableFiles: [],
      timetableUrls: [],
      now: () => new Date(retrievedAt)
    });
    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it("maps enabled Bahamut reference times into Beijing update slots", async () => {
    const adapter = new BahamutSourceAdapter({
      enabled: true,
      entries: [
        {
          title: "Bahamut Reference Anime",
          url: "https://ani.gamer.com.tw/animeVideo.php?sn=123",
          sn: "123",
          uploadDate: "2026-07-03",
          uploadTime: "23:30",
          bangumiSubjectId: 2001,
          format: "tv",
          retrievedAt
        }
      ],
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });
    const item = result.items[0];

    assert.equal(item?.id, "anime:2001");
    assert.equal(item?.updateTime, "23:30");
    assert.equal(item?.updateWeekday, 5);
    assert.equal(item?.timezone, "Asia/Shanghai");
    assert.equal(item?.schedule[0]?.airDate, "2026-07-03");
    assert.equal(item?.schedule[0]?.timezone, "Asia/Shanghai");
    assert.equal(item?.sources[0]?.scope, "taiwan_streaming");
    assert.equal(result.warnings.length, 0);
  });

  it("marks historical Bahamut reference rows finished", () => {
    const item = mapBahamutReferenceToAnimeItem(
      {
        title: "Historical Bahamut Reference",
        url: "https://ani.gamer.com.tw/animeVideo.php?sn=2024",
        sn: "2024",
        uploadDate: "2024-04-05",
        uploadTime: "22:30",
        bangumiSubjectId: null,
        format: "tv",
        retrievedAt
      },
      retrievedAt
    );

    assert.equal(item?.status, "finished");
    assert.equal(item?.endDate, "2024-06-30");
    assert.equal(item?.updateWeekday, null);
    assert.equal(item?.updateTime, null);
    assert.equal(item?.schedule[0]?.airTime, "22:30");
  });

  it("parses Bahamut timetable text into structured reference slots", () => {
    const entries = parseBahamutTimetableText(
      [
        "07/04（週六）19:00 《Timetable Anime A》更新",
        "7/12 起每週日 23:00 更新《Timetable Anime B》"
      ].join("\n"),
      { year: 2026, url: "https://gnn.gamer.com.tw/detail.php?sn=307681", retrievedAt }
    );

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.title, "Timetable Anime A");
    assert.equal(entries[0]?.uploadDate, "2026-07-04");
    assert.equal(entries[0]?.uploadTime, "19:00");
    assert.equal(entries[1]?.title, "Timetable Anime B");
    assert.equal(entries[1]?.uploadDate, "2026-07-12");
    assert.equal(entries[1]?.uploadTime, "23:00");
    assert.equal(entries[1]?.format, "tv");
  });

  it("parses Bahamut date headings followed by time-title rows", () => {
    const entries = parseBahamutTimetableText(
      [
        "07/05（週日）",
        "21:30 《Date Header Anime》更新",
        "22:5 《Single Digit Minute Anime》更新"
      ].join("\n"),
      { year: 2026, season: 7, url: "https://forum.gamer.com.tw/C.php?bsn=60037&snA=82874", retrievedAt }
    );

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.title, "Date Header Anime");
    assert.equal(entries[0]?.uploadDate, "2026-07-05");
    assert.equal(entries[0]?.uploadTime, "21:30");
    assert.equal(entries[1]?.title, "Single Digit Minute Anime");
    assert.equal(entries[1]?.uploadTime, "22:05");
  });

  it("fetches configured Bahamut timetable pages without failing the whole source on blocked pages", async () => {
    const adapter = new BahamutSourceAdapter({
      enabled: true,
      referencesPath: "tests/fixtures/missing-bahamut-references.json",
      timetableUrls: ["https://example.test/timetable", "https://example.test/blocked"],
      fetchImpl: async (url) => {
        if (String(url).includes("blocked")) return new Response("blocked", { status: 403 });
        return new Response("<p>07/04（週六）19:00 《Fetched Timetable Anime》更新</p>");
      },
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });
    const item = result.items.find((candidate) => candidate.title.original === "Fetched Timetable Anime");

    assert.equal(item?.updateTime, "19:00");
    assert.equal(item?.updateWeekday, 6);
    assert.equal(item?.schedule[0]?.airDate, "2026-07-04");
    assert.equal(result.warnings.some((warning) => warning.code === "SOURCE_BLOCKED"), true);
  });

  it("parses YourAnimes JSON-LD entries with Bangumi IDs", () => {
    const entries = parseYourAnimesHtml(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "ItemList",
        itemListElement: [
          {
            "@type": "ListItem",
            item: {
              "@type": "TVSeries",
              name: "YourAnimes Reference",
              url: "https://youranimes.tw/animes/1",
              datePublished: "2026-07-17T23:30:00+09:00",
              numberOfEpisodes: 12,
              sameAs: ["https://bangumi.tv/subject/517106"]
            }
          }
        ]
      })}</script>`,
      { url: "https://youranimes.tw/bangumi/202607", retrievedAt }
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.bangumiSubjectId, 517106);
    assert.equal(entries[0]?.publishedAt, "2026-07-17T23:30:00+09:00");
    assert.equal(entries[0]?.episodeCount, 12);
    assert.deepEqual(entries[0]?.aliases, []);
  });

  it("maps YourAnimes Japan broadcast times into Beijing update slots", () => {
    const item = mapYourAnimesReferenceToAnimeItem(
      {
        title: "YourAnimes Reference",
        aliases: ["YourAnimes Alias"],
        url: "https://youranimes.tw/animes/1",
        publishedAt: "2026-07-17T23:30:00+09:00",
        episodeCount: 12,
        bangumiSubjectId: 517106,
        retrievedAt
      },
      retrievedAt
    );

    assert.equal(item?.id, "anime:517106");
    assert.equal(item?.startDate, "2026-07-17");
    assert.equal(item?.updateWeekday, 5);
    assert.equal(item?.updateTime, "22:30");
    assert.equal(item?.episodeCount, 12);
    assert.equal(item?.timezone, "Asia/Shanghai");
    assert.equal(item?.sources[0]?.scope, "japan_broadcast");
  });

  it("marks historical YourAnimes reference rows finished", () => {
    const item = mapYourAnimesReferenceToAnimeItem(
      {
        title: "Historical YourAnimes Reference",
        aliases: [],
        url: "https://youranimes.tw/animes/2024",
        publishedAt: "2024-04-05T23:30:00+09:00",
        episodeCount: 12,
        bangumiSubjectId: null,
        retrievedAt
      },
      retrievedAt
    );

    assert.equal(item?.status, "finished");
    assert.equal(item?.endDate, "2024-06-30");
    assert.equal(item?.episodeCount, 12);
    assert.equal(item?.airedEpisodeCount, 12);
    assert.equal(item?.updateWeekday, null);
    assert.equal(item?.updateTime, null);
    assert.equal(item?.schedule[0]?.airTime, "22:30");
  });

  it("reads YourAnimes timetable files as a low-priority reference source", async () => {
    const adapter = new YourAnimesSourceAdapter({
      timetableFiles: ["tests/fixtures/youranimes-sample.html"],
      timetableUrls: [],
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "anime:517106");
    assert.equal(result.items[0]?.updateTime, "22:30");
    assert.equal(result.warnings.length, 0);
  });

  it("falls back to dynamic YourAnimes quarter URLs when the implicit local cache file is missing", async () => {
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = "tests/fixtures/missing-youranimes-cache";
    let requestedUrl = "";
    const adapter = new YourAnimesSourceAdapter({
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(`<script type="application/ld+json">${JSON.stringify({
          "@type": "ItemList",
          itemListElement: [
            {
              "@type": "ListItem",
              item: {
                "@type": "TVSeries",
                name: "YourAnimes 2025 Reference",
                url: "https://youranimes.tw/animes/2025",
                datePublished: "2025-07-05T00:30:00+09:00",
                sameAs: ["https://bangumi.tv/subject/202507"]
              }
            }
          ]
        })}</script>`);
      },
      now: () => new Date(retrievedAt)
    });

    try {
      const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });

      assert.equal(requestedUrl, "https://youranimes.tw/bangumi/202507");
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.id, "anime:202507");
      assert.equal(result.items[0]?.startDate, "2025-07-04");
      assert.equal(result.items[0]?.status, "finished");
      assert.equal(result.items[0]?.updateTime, null);
      assert.equal(result.items[0]?.schedule[0]?.airTime, "23:30");
      assert.equal(result.warnings.length, 0);
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
    }
  });

  it("keeps warning for explicitly configured missing YourAnimes timetable files", async () => {
    const adapter = new YourAnimesSourceAdapter({
      timetableFiles: ["tests/fixtures/missing-youranimes.html"],
      timetableUrls: [],
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.message, "failed to read YourAnimes timetable file: tests/fixtures/missing-youranimes.html");
  });
});
