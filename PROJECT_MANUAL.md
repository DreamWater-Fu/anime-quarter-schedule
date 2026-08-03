# Project Manual: 日本季度新番时间表

最后更新: 2026-08-03

本文件是后续 AI 的项目入口。先读本文件，再读相关代码。修改项目边界、季度规则、数据源、部署方式、缓存状态或数据口径时，必须同步更新本文件。

## 1. 当前状态

- 版本: `0.2.5`
- 技术栈: Next.js App Router, React, TypeScript, Node.js `>=24`
- 核心缓存: `data/anime.json`
- 当前缓存: 853 条, 只保留 TV、日本动画、非 excluded 条目; 当前已导入的 2023-2026 多个季度均可被全库搜索与全库个人记录回查, 长门有C / YucWiki 季度页面快照、Bangumi 月度本地快照和 YourAnimes 本地快照保留为旧季度更新备用
- 测试: 110 个单元测试; 最近 `npm run check` 通过
- 当前部署: GitHub Pages 静态公开页已成功; Vercel 仍可作为只读动态部署备选
- 最近数据自检: 2026-08-03 已逐季强制重建 2023-2026 已缓存季度, 当前 853 条中 836 条带长门有C / YucWiki 主源, 708 条带 YourAnimes 参考源; 修复 Bangumi 补强算法后封面缺失为 0, 847 条带 Bangumi 源, 7 条缺可靠 Bangumi subjectId, 13 条缺 Bangumi 评分, 其中 6 条是未来 Bangumi subject 当前无有效评分。Bangumi 匹配已先修复 subject 快照和在线搜索响应中的 mojibake, 再按日文名、官网、日期、集数、季数/Part/cour 证据打分; 中文译名只作为辅助, 不要求完全一致。若 Bangumi 将同一季或上下半 cour 合并为一个 subject, 长门有C 上的 Part 条目可共用同一 Bangumi subjectId 与评分。2026 年 10 月长门页当前返回 404, 因而该未来季度 14 条暂按 Bangumi / YourAnimes fallback 保留。更新前后确认同一作品 id 改变 3 条: `anime:325767` -> `anime:yucwiki:202607:b29` (`感谢对战 大小姐才不玩格斗游戏`), `anime:528828` -> `anime:yucwiki:202607:c05` (`骸骨骑士大人异世界冒险中 第2期`), `anime:614594` -> `anime:yucwiki:202607:b20` (`令和的斑小姐`); 另有旧目录 242 条不再被新主目录保留, 新主目录加入 157 条。2026-08-03 全库审查已清理 2023 年 4 月等季度残留的国产/欧美/海外儿童 IP 条目; `Nyaaaanvy`、`太乐巴戈斯的闪闪发亮探险记` 等非日漫或 SP 已排除; `おじゃる丸 第26シリーズ`、`おじゃる丸 第27シリーズ` 等第 11 季以上条目已排除; 同季同 Bangumi subject 的参考源残留已删除, 仅跨季 Part/cour 可按强证据共用同一 Bangumi subjectId 与评分; 已完结/取消条目顶层 `updateTime` / `updateWeekday` 全部置空, 但 `startDate` 与 `schedule[]` 首播记录保留

## 2. 产品边界

只展示日本 TV 动画。

必须排除:

- 中国动画、中日合作动画、海外动画、韩产动画、欧美动画
- WEB、OVA、MOVIE、SP 等非 TV 条目
- 标题或元数据表明为剧场版、电影、MOVIE、THE MOVIE、film 的条目, 即使平台误标为 TV 也必须排除
- 标题明确标为第 11 季及以上的条目必须排除; 第 10 季及以下可以保留; 规则覆盖中文 `第十一季`、日文 `第26シリーズ` 和英文 `Series 32` / `Season 32` 等写法
- R18、NSFW、成人内容
- `isJapaneseAnime=false` 或 `inclusionStatus="excluded"` 条目

非日漫过滤必须先统一修复 UTF-8 被误读为 Latin-1 的 mojibake 文本, 再判断:

- 标题、中文名、别名或官网命中明确海外 IP / 国产少儿动画 / 韩产儿童动画标题信号时排除
- Bangumi tags 或产地字段命中 `中国`、`中国大陆`、`国产`、`国创`、`国产动画`、`中国动画`、`美国`、`欧美`、`英国`、`法国`、`加拿大`、`韩国`、`韩产` 等强元数据时排除
- Bangumi 主标题为韩文且没有日文假名信号时排除
- 命中强元数据时仍要检查是否存在日文假名、`日本动画`、日本电视台、日方官网或日方制作公司等强日方制作信号; 不要仅因 `韩国`、`韩漫`、`韩国原作改编`、`中国原作`、`国产`、`中国` 等原作或标签信号删除日方制作的 TV 动画, 例如 `明日方舟` 系列以动画制作/播放形态为准

缺失字段用 `null`, 不要用空字符串、`N/A` 或 `0` 占位。不要重新引入 Syoboi、AniList、中国动画数据源、官方站批量爬虫或海外动画数据源。

## 3. 季度规则

番剧归属只由开播日期决定, 不由终播日期、最后一集日期或排期覆盖决定。

宽限窗口:

- 3 月 18 日至 6 月 16 日开播: 四月新番
- 6 月 17 日至 9 月 16 日开播: 七月新番
- 9 月 17 日至 12 月 17 日开播: 十月新番
- 12 月 18 日至次年 3 月 17 日开播: 下一年一月新番

实现位置:

- `src/server/anime/calculateSeason.ts`
- `src/app/lib/season.ts`

`primarySeason` 是唯一归属依据。`activeSeasons` 只表示排期覆盖和续播元数据。

续播展示规则:

- 只有请求季度等于当前北京时间实际季度时, 才允许用 `activeSeasons` 展示旧季度续播条目。
- 未来季度不得提前显示当前季度的续播作品。

## 4. 目录地图

```text
app/                          Next App Router 页面和 API route
src/app/components/           前端组件
src/app/lib/                  前端查询、格式化、筛选辅助
src/server/anime/             查询、季度计算、更新编排、校验
src/server/api/               API 适配层
src/server/cache/             本地 JSON 存储和状态缓存
src/server/sources/yucwiki/   长门有C / YucWiki 主目录源
src/server/sources/bangumi/   Bangumi 客户端、映射、匹配
src/server/sources/bahamut/   巴哈姆特遗留参考源, 默认更新流程不再注册
src/server/sources/youranimes/ YourAnimes 参考源
src/server/types/             核心类型
data/                         本地缓存、参考源快照、人工覆盖
scripts/                      数据更新、校验、静态导出脚本
tests/unit/                   单元测试
tests/fixtures/               测试夹具
.github/workflows/pages.yml   GitHub Pages 自动部署
```

## 5. 数据口径

类型定义: `src/server/types/anime.ts`

关键类型:

- `SeasonMonth = 1 | 4 | 7 | 10`
- `AnimeQuarter = winter | spring | summer | fall`
- `DataStatus = complete | partial | conflicting | unverified`
- `InclusionStatus = included | optional | excluded | needs_review`

数据状态:

- `complete`: 关键资料齐全, 且没有来源冲突
- `partial`: 缺关键资料, 例如无开播日期或无排期
- `unverified`: 匹配置信度不足, 需要人工确认
- `conflicting`: 来源之间存在冲突
- 缺 Bangumi 评分只进 `missingRating` 统计, 不得单独导致 `partial`

其他硬规则:

- 非日本动画必须写 `isJapaneseAnime=false`, `inclusionStatus="excluded"`, `exclusionReason`
- 可展示条目至少保留一个 `sources[]`
- 已完结或取消条目不再继承顶层 `updateTime` / `updateWeekday`; 但必须保留 `startDate` 与 `schedule[]` 中的首播日期/时间记录, 用于搜索、回查、在看记录和观看记录展示
- `episodeCount` 与 `airedEpisodeCount` 不得矛盾
- 长门有C、YourAnimes、人工覆盖写入的展示时间按北京时间 `Asia/Shanghai` 处理; 巴哈姆特仅作为遗留适配器保留
- Bangumi 标题映射会修复 UTF-8 被误读为 Latin-1 的 mojibake, 不要移除
- Bangumi 标题匹配以日文名、原名、官网、日期、集数和季数/Part/cour 为主; 中文译名不要求完全一致。日文核心名可接受候选标题的长短差异, 例如长门短名 `凍牌` 可匹配 Bangumi 长名 `凍牌～裏レート麻雀闘牌録～`
- Bangumi 非日漫过滤包含明确排除 subjectId、标题/IP 规则、tags/产地强元数据规则、韩文主标题规则、已知 SP 标题规则和第 11 季以上规则, 不要把已确认的国产/海外/韩产动画、SP、剧场版或超十季条目重新放回可展示缓存

## 6. API 与静态模式

动态 API:

- `GET /api/anime?year=YYYY&season=1|4|7|10`
- `GET /api/search?q=keyword&limit=20`: 在当前 `data/anime.json` 可展示 TV 日漫库内按标题、中文名、日文名、英文名和别名搜索, 返回轻量结果及 `primarySeason`
- `GET /api/items?ids=id1,id2`: 按 `AnimeItem.id` 从全库读取可展示 TV 日漫条目, 供在看记录、观看记录等本地个人状态跨季度回查完整公共数据
- `GET /api/status`
- `POST /api/update` body: `{ year, season, force? }`

API 永远过滤非日本动画、excluded、非 TV 和成人内容。

Vercel 默认只读: `process.env.VERCEL === "1"` 且 `ENABLE_VERCEL_UPDATE !== "true"` 时 `/api/update` 返回 403。设置 `UPDATE_API_TOKEN` 后, 更新请求必须带 Bearer Token 或 `x-update-token`。

GitHub Pages 静态模式:

- 前端通过 `NEXT_PUBLIC_STATIC_EXPORT=true` 读取 `/static-data/anime.json` 和 `/static-data/status.json`
- 静态页面不调用 `/api/*`
- 静态搜索不调用 `/api/search`, 直接读取 `/static-data/anime.json` 并复用 `src/shared/animeSearch.ts` 的过滤和匹配规则
- 静态在看记录和观看记录不调用 `/api/items`, 直接读取 `/static-data/anime.json` 后按本地 `watchingIds` / `completedIds` 匹配
- 更新按钮在静态模式下禁用

PWA 与缓存:

- Web App Manifest 位于 `public/manifest.webmanifest`, 通过 `app/layout.tsx` metadata 挂载; manifest 内的 `start_url`、`scope` 和图标路径使用相对路径, 兼容 GitHub Pages 的 `basePath`。
- PNG 图标位于 `public/icons/`, 至少包含 `icon-192.png`、`icon-512.png`、`maskable-512.png` 和 `apple-touch-icon.png`; 不依赖远程图标。
- Service Worker 位于 `public/sw.js`, 由 `src/app/components/PwaServiceWorker.tsx` 在生产环境注册; 注册地址和 scope 使用 `NEXT_PUBLIC_BASE_PATH` 适配 GitHub Pages。
- 页面壳、Next 静态资源、manifest 和图标可缓存以提升再次打开速度。
- `/static-data/anime.json` 与 `/static-data/status.json` 必须采用 network-first 策略: 有网优先读取 GitHub Pages 最新 JSON, 网络失败时才回退到缓存, 不允许长期锁死旧公开数据。
- Service Worker 不读取、不写入、不清空 `localStorage`, 不参与个人追番状态迁移。

## 7. 数据源与更新

数据源:

- 长门有C / YucWiki: 主目录源, 提供季度番剧列表、标题、播放日期/时间标签、放送形态、官网、制作信息、集数和封面链接; 优先决定目标季度可写入目录。默认读取 `https://yuc.wiki/YYYYMM/`, 成功获取后写入 `data/yucwiki-YYYYMM.html` 作为本地快照
- Bangumi: 次源, 主要补齐已匹配条目的 subjectId、评分、排名、封面和条目信息; 成功读取月度 subject 列表后会写入 `data/bangumi-YYYYMM-subjects.json` 作为本地快照。月度列表不是完整番剧目录, 只能作为批量候选快照; 长门条目缺 subjectId 时必须通过 `data:match-bangumi` 的在线搜索补强继续匹配。长门有C主目录存在时, 未能匹配到长门条目的 Bangumi-only 条目不得单独写入缓存
- YourAnimes: 低优先级参考源, 保持原用途, 补充日本首播时间和 Bangumi subjectId; 当主目录源与 Bangumi 均不可用且目标季度无旧缓存时, 可信参考源可冷启动导入 `partial` / `needs_review` 条目
- 巴哈姆特: 遗留参考源适配器仍保留给旧测试和手动调试, 但默认更新流程已经由长门有C替代, 不再作为默认数据源注册
- `data/manual-broadcast-overrides.json`: 最终人工覆盖, 只对未完结、未取消条目生效

常用数据命令:

```powershell
npm run data:update -- --year 2026 --season 7
npm run data:reconcile
npm run data:refresh-bangumi
npm run data:sync-bangumi
npm run data:match-bangumi
npm run data:validate
npm run data:audit
```

源配置:

- `YUCWIKI_ENABLED=false` 可禁用长门有C主源; `YUCWIKI_PAGE_URL` 可覆盖季度页面地址; `YUCWIKI_USER_AGENT`、`YUCWIKI_TIMEOUT_MS`、`YUCWIKI_RATE_LIMIT_PER_MINUTE` 控制抓取请求
- 本地存在 `data/yucwiki-YYYYMM.html` 时优先读取本地快照, 网络不可用时仍可更新已缓存季度
- `BANGUMI_*` 配置继续只影响 Bangumi 次源; `YOURANIMES_*` 配置继续只影响 YourAnimes 参考源
- Bangumi 季度候选月份必须覆盖本项目宽限窗口: 一月季查上一年 12 月到当年 3 月, 四月季查 3-6 月, 七月季查 6-9 月, 十月季查 9-12 月; 月度列表需要按 `limit/offset` 分页抓取, 不得只读取第一页

更新流程要点:

1. 校验 `year` 和 `season`
2. 检查更新锁
3. 按优先级读取长门有C、Bangumi、YourAnimes
4. 归一化、去重、按 `primarySeason` 过滤目标季度
5. 若长门有C主目录有可写入条目, 以长门条目为目录主体; Bangumi 只合并到同标题/高置信匹配条目上补齐评分、排名、subjectId、封面等信息, 未匹配的 Bangumi-only 条目会被丢弃
6. 主目录源与 Bangumi 均不可用且目标季度无旧缓存时, 对无 Bangumi ID 且无旧缓存匹配的 YourAnimes 参考条目, 仅在来源可信、格式为 TV、具备开播日期与排期时允许冷启动, 并标记为 `needs_review`
7. 过滤 TV、日本动画、非成人内容、剧场版/电影标题、已知 SP 标题和第 11 季及以上条目; 非日漫过滤必须同时读取标题/别名/官网、Bangumi tags、产地字段和韩文主标题信号, 并用强日方制作信号保护 `明日方舟` 这类特殊条目
8. 与旧缓存合并, 保留可靠旧信息
9. 应用人工广播覆盖
10. 校验并写入 `data/anime.json`, `data/status.json`, `data/update-log.jsonl`

失败策略:

- 写入前校验失败: 不覆盖旧缓存
- 外部源失败: 记录 warning, 尽量保留可用旧缓存
- 目标季度无旧缓存且外部源无可写入条目但有 warning: 返回 `SOURCE_UNAVAILABLE`, 不写入空成功
- 长门有C季度页面快照和 Bangumi 月度快照存在时优先读取本地文件; 页面更新在网络不可用时仍可刷新已缓存月份
- `scripts/reconcile-current-cache.ts` 会回查本地 `data/bangumi-YYYYMM-subjects.json` 快照, 用同一套标题/IP、tags/产地、韩文主标题、已知 SP 和第 11 季以上规则清理既有缓存; 它也会清空已完结/取消条目的顶层更新时间, 并删除同季同 Bangumi subject 的次级重复项, 但允许上下半 cour / Part 跨季共用 subject
- `npm run data:audit` 是只读全缓存审查脚本, 会检查 schema、非 TV、非日漫、excluded、剧场版/电影、已知 SP、第 11 季以上、成人内容、已完结顶层更新时间、缺来源、缺封面、重复 id、同季重复 subject 和同季重复标题; 缺 Bangumi 评分/subjectId 只作为可接受告警统计
- 旧季度导入优先使用长门有C; Bangumi 只作为评分和 subjectId 补强。长门有C与 Bangumi 网络失败时, 可使用 `data/youranimes-YYYYMM.html` 等本地参考源快照完成低置信度冷启动, 后续再用长门有C重建目录并用 Bangumi 同步补齐评分、封面和 subjectId
- `npm run data:refresh-bangumi` 会按当前缓存中涉及的季度窗口分页刷新 `data/bangumi-YYYYMM-subjects.json`; 该命令只刷新 Bangumi 候选快照, 不直接修改番剧主缓存
- `npm run data:sync-bangumi` 会优先使用本地 `data/bangumi-YYYYMM-subjects.json` 快照, 对已匹配 Bangumi subjectId 的条目刷新评分、封面、集数和状态, 并对缺 subjectId 的长门条目尝试本地高置信匹配; 不足阈值的条目保持缺评分状态, 不做冒险写入。可加 `-- --local-only` 只使用本地 Bangumi 快照补强缺 subjectId, 不执行在线详情刷新
- `npm run data:match-bangumi` 是在线 Bangumi 搜索补强脚本, 需要修复搜索响应中的 mojibake 后再评分; 自动接受标题/别名强匹配并具备日期、官网、集数、季数或制作信息辅助证据的候选。中文标题不要求完全一致, 因为日文译名可能存在长短译名或不同译名; 当官网、日期、集数、季数或制作信息形成强证据时, 可接受中文译名弱匹配。对上下半 cour / Part 共用同一 Bangumi subject 的情况, 允许多个长门条目共用同一个 Bangumi subjectId 和评分; 格式冲突、多候选接近或缺少官网/日期/季数等辅助证据的弱标题候选仍保持拒绝
- 参考源冷启动的历史季度条目会按导入时刻推断为 `finished`, 顶层 `updateTime` / `updateWeekday` 置空, 但 `schedule[]` 仍保留首播日期和时间用于搜索与回查

## 8. 部署

本地:

```powershell
npm install
npm run dev:local
npm run check
```

普通 Next/Vercel 构建:

```powershell
npm run build
```

GitHub Pages 静态构建:

```powershell
npm run build:static
```

静态构建说明:

- `scripts/prepare-static-export.mjs` 复制 `data/*.json` 到 `public/static-data/`
- `scripts/build-static.mjs` 临时移走 `app/api`, 清理 `.next`, 执行 `next build`, 最后恢复 `app/api`
- 输出目录是 `out/`
- `out/`, `public/static-data/`, `public/.nojekyll` 是构建产物, 不要提交
- GitHub Actions 工作流发布 `out/`
- 更新公开数据: 本地更新 `data/*.json`, 提交并 push, 让 Actions 重新发布

## 9. 本地个人状态与视图

当前前端支持纯本地个人状态，不写入 `data/*.json`，不进入 GitHub Pages 构建产物，也不改变公共数据口径。

默认进入页面时使用北京时间当前年份与当前季度。例如 2026-07-31 默认进入 `2026` 年 `七月新番`。URL 中显式提供 `year` 与 `season` 时, 仍以 URL 为准。

实现位置:

- `src/app/lib/userAnimePrefs.ts`: 读写 `localStorage`
- `src/app/components/UserAnimeActionButton.tsx`: 追番 / 在看 / 观毕按钮
- `src/app/components/ViewModeSwitcher.tsx`: 独立且紧凑的浏览模式入口, 从筛选中剥离统计列表、追番列表、个人追番、在看记录和观看记录; 移动端主列表入口独占第一行突出显示, 其余四个模式保持小尺寸并以 2x2 对称排列
- `src/app/components/ScheduleControls.tsx`: 范围与状态筛选入口, 不再承载视图切换
- `src/app/components/AnimeSearch.tsx`: 默认折叠的全库番剧搜索入口, 展示匹配番剧的播放年份与季度, 点击结果切换到对应 `primarySeason`; 搜索结果可直接追番、在看或观毕; 缓存更新时间变化后会刷新已有搜索词
- `src/shared/animeSearch.ts`: 动态 API 与静态页面共用的搜索过滤、匹配和排序规则
- `src/app/components/FollowSchedule.tsx`: 追番时间轴与个人追番复用视图
- `src/app/components/ScheduleBoard.tsx` / `src/app/components/AnimeTable.tsx`: 统计列表、在看记录与观看记录复用视图

本地存储:

- key: `anime-quarter-schedule:user-prefs:v1`
- schema: `{ followedIds: string[], watchingIds: string[], completedIds: string[] }`
- 只保存 `AnimeItem.id`, 不保存完整番剧对象、标题、时间、封面或公共数据副本
- GitHub Pages 更新公共 JSON 后, 用户本地 `localStorage` 不会被覆盖
- PWA 安装、重新部署或 Service Worker 缓存更新不会覆盖、清空或反向迁移本地 `localStorage` 个人状态
- 若用户清理浏览器数据、换浏览器、换域名或换设备, 本地个人状态不会自动迁移

视图:

- `search`: 全库搜索入口, 不受当前季度筛选影响; 只搜索可展示 TV 日本动画, 排除 `isJapaneseAnime=false`、`inclusionStatus="excluded"` 和非 TV 条目
- `stats`: 统计列表, 展示当前筛选后的季度条目
- `following`: 追番列表, 点击进入时切换到北京时间当前年份与当前季度; 按周几展示当前筛选后的连载/延期条目, 仍受范围、状态和排序筛选影响
- `personalFollowing`: 个人追番, 点击进入时与追番列表一样切换到北京时间当前年份与当前季度; 与追番列表形式一致, 在追番列表的周几、连载状态判断上额外要求 `followedIds` 包含条目 `id`
- `watching`: 在看记录, 不受当前年份、季度、范围和状态筛选影响; 按 `watchingIds` 从全库回查可展示条目并显示全部未看完的已完结作品, 表格额外显示作品所属 `primarySeason` 季度
- `watchHistory`: 观看记录, 不受当前年份、季度、范围和状态筛选影响; 按 `completedIds` 从全库回查可展示条目并显示全部已观毕作品, 表格额外显示作品所属 `primarySeason` 季度

操作规则:

- `status === "airing"` 的条目显示“追番”, 点击后变为“已追番”, 再点取消
- `status === "finished"` 且未观毕的条目显示“在看”和“观毕”; “在看”可切换为“已在看”, 用于标记未看完的已完结作品
- 从“已在看”点击“观毕”会从 `watchingIds` 移除并加入 `completedIds`; `completedIds` 是终态, 已观毕作品不显示“在看”入口, 取消“已观毕”后回到未交互过的完结动画状态
- 其他状态暂不显示个人状态操作
- 当本地已追番条目在新公共数据中变为 `status === "finished"` 时, 自动从 `followedIds` 清除, 不自动加入 `completedIds`; 该作品回到未交互过的完结动画状态, 用户可再手动点“观毕”
- `watchingIds` 只保留已完结作品; 当加载到的公共数据表明某条记录不再是 `status === "finished"` 时, 自动从 `watchingIds` 清除
- 个人状态只保存并按 `AnimeItem.id` 匹配; 个人追番视图使用当前季度数据, 在看记录和观看记录通过全库回查匹配; 不要用本地个人状态反向修改公共缓存

## 10. 后续 AI 约束

必须:

- 先读本文件, 再读相关代码
- 以本文件当前规则和用户最新确认规则为准
- 修改核心规则、部署方式或数据口径后同步更新本文件
- 修改核心逻辑后运行 `npm run check`
- 修改数据后运行 `npm run data:validate`
- 保留用户未要求删除的文件和数据

禁止:

- 不要恢复旧需求文档作为依据
- 不要重新引入已排除数据源
- 不要把当前季度续播提前显示到未来季度
- 不要把缺评分单独判定为信息不完整
- 不要把已完结或取消条目重新标成有固定更新时间
- 不要提交构建产物
