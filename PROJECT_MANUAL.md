# Project Manual: 番剧更新时间表

最后更新: 2026-08-04

本文件是后续 AI 和维护者的项目入口。修改产品边界、数据源、更新流程、缓存状态、API 口径或部署方式后, 必须同步更新本文件。开始改代码前先读本文件, 再读相关实现。

## 1. 项目概览

- 技术栈: Next.js App Router, React, TypeScript, Node.js `>=24`
- 核心缓存: `data/anime.json`
- 更新状态: `data/status.json`
- 更新日志: `data/update-log.jsonl`
- 核心类型: `src/server/types/anime.ts`
- 统一展示/缓存边界: `src/server/anime/cacheEligibility.ts`
- 更新主流程: `src/server/anime/updateAnimeData.ts`
- 查询/API 过滤: `src/server/anime/queryAnime.ts`

不要提交构建产物, 例如 `.next/`, `out/`, `public/static-data/`, `public/.nojekyll`, `tsconfig.tsbuildinfo`。

## 2. 产品边界

产品只展示和缓存“日本 TV 动画”。任何数据源、脚本和网页/API 查询都不能扩大这个边界。

必须排除:

- 非 TV: WEB, OVA, MOVIE, SP, recap, PV, CM, music video, rebroadcast 等
- 非日本动画: 国产、欧美、海外儿童 IP、韩产动画等
- 剧场版、电影、MOVIE、THE MOVIE、film, 即使源平台误标为 TV
- 成人、R18、NSFW、擦边成人向
- 标题明确为第 11 季及以上; 第 10 季及以下可保留
- `isJapaneseAnime === false`
- `inclusionStatus === "excluded"`
- 人工审查排除清单或明确排除 Bangumi subjectId 命中项

Bangumi-only 额外准入规则:

- 只有 Bangumi 来源的条目, 不能仅凭 Bangumi `platform=TV` 进入展示/缓存。
- Bangumi-only 条目必须具备强日方 TV 证据: 日文假名标题、日方官网或日本电视台域名、日方 staff/原作信号, 或非 Bangumi 播出日程来源。
- 缺少长门有C/YucWiki、YourAnimes `japan_broadcast` 或其他非 Bangumi 目录/参考证据时, 英文/中文标题、海外/国产播出日期、Bangumi 月表 TV 标记都不足以通过。

Bangumi 匹配只补 subjectId、评分、封面和元数据, 不得用于重新导入 WEB、剧场版、SP、成人向或非日漫条目。

## 3. 季度规则

番剧归属只由首播日期决定, 不由完结日期或最后一集日期决定。

- 3 月 18 日至 6 月 16 日: spring / 4 月新番
- 6 月 17 日至 9 月 16 日: summer / 7 月新番
- 9 月 17 日至 12 月 17 日: fall / 10 月新番
- 12 月 18 日至次年 3 月 17 日: winter / 1 月新番

实现位置:

- `src/server/anime/calculateSeason.ts`
- `src/app/lib/season.ts`

`primarySeason` 是唯一归属依据。`activeSeasons` 只表示排期覆盖和续播元数据。只有请求季度等于当前北京时间实际季度时, 页面/API 才允许用 `activeSeasons` 展示旧季度续播条目; 未来季度不得提前显示当前季度续播作品。

## 4. 数据源

默认更新数据源:

- YucWiki / 长门有C: 主目录源。提供季度目录、标题、首播信息、放送形态、官网、制作信息、集数和封面。默认读取 `https://yuc.wiki/YYYYMM/`, 成功后写入 `data/yucwiki-YYYYMM.html` 快照。
- Bangumi: 次源。补齐已匹配条目的 subjectId、评分、排名、封面和详情。月度 subject 列表会写入 `data/bangumi-YYYYMM-subjects.json`, 但它不是完整季度目录, 只能作为候选池和元数据补强源。
- YourAnimes: 低优先级参考源。补充日本首播时间和 Bangumi subjectId。只有在主目录源与 Bangumi 均不可用且目标季度无旧缓存时, 可信 `japan_broadcast` 参考项才可冷启动为 `partial` / `needs_review`。
- Bahamut: 遗留参考源适配器, 保留给旧测试和手动调试; 默认更新流程不注册。
- `data/manual-broadcast-overrides.json`: 最终人工播出时间覆盖, 只对未完结、未取消条目生效。

YucWiki 缺日期条目规则:

- YucWiki 页面可能存在标题, 但播出日期缺失、被注释、或只有“泡面番”等无法解析文本。
- 这类条目不能直接生成新的 AnimeItem, 因为数据模型要求 `primarySeason` 与 `startDate` 一致。
- YucWiki adapter 必须把这些标题作为结构化 `MISSING_FIELD` warning 带出。
- 更新流程在目标季度刷新时, 若旧缓存中存在同标题、同季度且仍通过 `isCacheEligibleAnime` 的条目, 必须继承旧条目并补上 YucWiki 来源, 避免“YucWiki 有标题但缺日期”的条目被主目录刷新误删。
- 如果 YucWiki 页面本身没有该标题, 不应仅因旧缓存存在而保留。

## 5. 更新流程

顺序必须保持:

1. 校验 `year` 和 `season`
2. 读取并归一化持久化更新状态, 释放过期文件锁
3. 检查进程内更新锁
4. 抓取 YucWiki、Bangumi、YourAnimes
5. 归一化、去重、按 `primarySeason` 过滤目标季度
6. 标记可信参考源冷启动项
7. 合并 YucWiki 缺日期标题对应的旧缓存继承项
8. 统一执行 `filter(isCacheEligibleAnime)`
9. 对筛选后仍缺 subjectId 且具备可搜索目录信号的条目执行 Bangumi 在线搜索增强
10. 对已绑定但缺评分或缺 Bangumi 封面的条目刷新 Bangumi 详情
11. 与旧缓存合并, 应用人工播出覆盖
12. 校验并写入 `data/anime.json`, `data/status.json`, `data/update-log.jsonl`

关键约束:

- 必须先筛选、后匹配 Bangumi subject。
- 不允许先用 Bangumi 搜索结果决定是否展示。
- 长门有C/YucWiki 主目录存在时, 以 YucWiki 为目录主体; Bangumi-only 未匹配条目不得单独写入缓存。
- 冷启动参考源条目也必须先通过展示/缓存边界。
- 独立脚本 `scripts/match-missing-bangumi.ts` 必须复用同一套边界和搜索准入判断。

Bangumi 搜索增强准入:

- 已通过 `isCacheEligibleAnime`
- 当前没有 `bangumi.subjectId` 且没有 `externalIds.bangumiSubjectId`
- 来源为 YucWiki, 或 YourAnimes 且 `scope === "japan_broadcast"`

## 6. 失败与锁

更新锁有两层:

- 持久化锁: `data/status.json` 中的 `status: "running"` 与 `currentJob`
- 进程内锁: `updateAnimeData.ts` 的运行中标记

必须先读取并归一化持久化状态, 再判断是否拦截新更新。否则文件锁已经过期释放时, 进程内旧标记可能导致网页点击“重试更新”仍返回 `409 UPDATE_RUNNING`。

`GET /api/status` 会自愈过期更新锁:

- `UPDATE_LOCK_TTL_SECONDS` 默认 900 秒
- 如果 `currentJob.startedAt` 超过 TTL, 状态会写回 `failed`
- `currentJob` 会被清空
- `lastError.code` 为 `STALE_UPDATE_LOCK`

失败策略:

- 写入前校验失败: 不覆盖旧缓存
- 外部源失败: 记录 warning, 尽量保留可用旧缓存
- 目标季度无旧缓存且外部源无可写入条目: 返回 `SOURCE_UNAVAILABLE`
- 历史季度主目录不可用且有效候选低于 `MIN_HISTORICAL_CATALOG_ITEMS` 默认 13 条: 返回 `SOURCE_UNAVAILABLE`
- 历史季度主目录可用但 Bangumi 补全失败到会写入整季裸标题: 返回 `SOURCE_UNAVAILABLE`

## 7. API 与静态模式

动态 API:

- `GET /api/anime?year=YYYY&season=1|4|7|10`
- `GET /api/search?q=keyword&limit=20`
- `GET /api/items?ids=id1,id2`
- `GET /api/status`
- `POST /api/update` body: `{ year, season, force? }`

API 必须过滤非 TV、非日本动画、excluded、成人向和其他不符合展示边界的条目。

Vercel 默认只读:

- `process.env.VERCEL === "1"` 且 `ENABLE_VERCEL_UPDATE !== "true"` 时, `/api/update` 返回 403。
- 设置 `UPDATE_API_TOKEN` 后, 更新请求必须带 Bearer Token 或 `x-update-token`。

GitHub Pages 静态模式:

- `NEXT_PUBLIC_STATIC_EXPORT=true`
- 前端读取 `/static-data/anime.json` 与 `/static-data/status.json`
- 静态页面不调用 `/api/*`
- 更新按钮禁用
- 静态搜索和本地记录回查复用 `src/shared/animeSearch.ts`
- `/static-data/anime.json` 与 `/static-data/status.json` 必须 network-first, 网络失败时才回退缓存

## 8. 本地个人状态

个人状态只保存在浏览器 `localStorage`, 不写入 `data/*.json`, 不影响公共缓存。

- key: `anime-quarter-schedule:user-prefs:v1`
- schema: `{ followedIds: string[], watchingIds: string[], completedIds: string[] }`
- 只保存 `AnimeItem.id`, 不保存完整番剧对象

视图:

- `stats`: 当前季度统计列表
- `following`: 当前北京时间季度追番时间表
- `personalFollowing`: 当前季度个人追番
- `watching`: 全库在看记录
- `watchHistory`: 全库看完记录
- `search`: 全库可展示 TV 日本动画搜索

公共 JSON 更新、PWA 安装、Service Worker 缓存更新都不得清空或反向修改个人状态。

## 9. 常用命令

```powershell
npm install
npm run dev:local
npm run typecheck
npm run test
npm run data:update -- --year 2026 --season 7
npm run data:match-bangumi
npm run data:sync-bangumi
npm run data:validate
npm run data:audit
npm run build
npm run build:static
```

修改代码后至少运行相关测试和 `npm run typecheck`。修改数据后运行 `npm run data:validate`。

## 10. 目录地图

```text
app/                           Next App Router 页面和 API route
src/app/components/            前端组件
src/app/lib/                   前端查询、格式化、筛选辅助
src/shared/animeSearch.ts      动态 API 与静态页面共用搜索逻辑
src/server/anime/              查询、季度计算、更新编排、校验、缓存边界
src/server/api/                API 适配层
src/server/cache/              本地 JSON 存储和状态缓存
src/server/sources/yucwiki/    YucWiki / 长门有C 主目录源
src/server/sources/bangumi/    Bangumi 客户端、映射、匹配、搜索增强
src/server/sources/youranimes/ YourAnimes 参考源
src/server/sources/bahamut/    遗留参考源
src/server/types/              核心类型
data/                          本地缓存、快照、人工覆盖
scripts/                       数据更新、校验、静态导出脚本
tests/unit/                    单元测试
tests/fixtures/                测试夹具
```

## 11. 维护约束

必须:

- 先读本文件, 再读相关代码
- 遵循“只展示日本 TV 动画”的产品边界
- 修改核心规则、数据源、API、缓存状态或部署方式后同步本文件
- 保护用户未要求删除的文件和数据
- 不提交构建产物

禁止:

- 重新引入已排除的数据源或已确认排除条目
- 为了补 subjectId 把 WEB、剧场版、SP、成人向、非日漫条目当作 TV 导入
- 把 Bangumi 匹配结果用于扩大产品边界
- 把缺评分单独判定为信息不完整
- 把已完结或取消条目重新标成有固定更新时间
- 用少量 fallback 候选覆盖一个已有历史季度缓存
