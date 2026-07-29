# Project Manual：日本季度新番更新时间表

最后更新：2026-07-29

本文件是后续 AI 的项目入口。先读本文件，再读相关代码。修改项目边界、季度规则、数据源、更新流程、部署方式或数据状态口径时，必须同步更新本文件。

## 1. 当前状态

- 版本：`0.1.1`
- 技术栈：Next.js App Router、React、TypeScript、Node.js `>=24`
- 存储：本地 JSON 文件，核心缓存为 `data/anime.json`
- 当前缓存：326 条；全部为 TV、日本动画、非 excluded，封面缺失为 0
- 测试：91 个单元测试；最近 `npm run check` 通过
- 当前用途：个人使用的新番时间表；可作为只读公开网页部署到 Vercel

## 2. 产品边界

只展示日本 TV 动画。

必须排除：

- 中国动画、中日合作动画、海外动画
- WEB、OVA、MOVIE、SP 等非 TV 条目
- R18、NSFW、成人内容
- `isJapaneseAnime=false` 或 `inclusionStatus="excluded"` 条目

缺失字段用 `null`，不要用空字符串、`N/A` 或 `0` 占位。

不要重新引入 Syoboi、AniList、中国动画数据源、官方站批量爬虫或海外动画数据源。

## 3. 季度归属规则

番剧归属只由开播日期决定，不由终播日期、最后一集日期或排期覆盖决定。

宽限窗口：

- 3 月 18 日至 6 月 16 日开播：四月新番
- 6 月 17 日至 9 月 16 日开播：七月新番
- 9 月 17 日至 12 月 17 日开播：十月新番
- 12 月 18 日至次年 3 月 17 日开播：下一年一月新番

实现：

- `src/server/anime/calculateSeason.ts`
- `calculatePrimarySeason`
- `getCurrentSeasonKey`

`primarySeason` 是唯一归属依据。`activeSeasons` 只表示排期覆盖和续播元数据。

续播展示规则：

- 只有请求季度等于当前北京时间实际季度时，才允许用 `activeSeasons` 展示旧季度续播条目。
- 未来季度不得提前显示当前季度的续播作品。
- 例：当前仍是 2026 年七月新番时期时，七月番即使排期延伸到 10 月，也不能出现在 2026 年十月新番页。

## 4. 目录地图

```text
app/                         Next App Router 页面与 API 路由
src/app/components/          前端组件
src/app/lib/                 前端查询、格式化、筛选辅助
src/server/anime/            查询、季度计算、更新编排、校验
src/server/api/              API 适配层
src/server/cache/            本地 JSON 存储和状态缓存
src/server/sources/bangumi/  Bangumi 客户端、映射、匹配
src/server/sources/bahamut/  巴哈姆特参考源
src/server/sources/youranimes/ YourAnimes 参考源
src/server/types/            核心类型
data/                        本地缓存、参考源快照、人工覆盖
scripts/                     数据初始化、更新、校验、同步脚本
tests/unit/                  单元测试
tests/fixtures/              测试夹具
```

## 5. 核心数据规则

类型定义在 `src/server/types/anime.ts`。

关键类型：

- `SeasonMonth = 1 | 4 | 7 | 10`
- `AnimeQuarter = winter | spring | summer | fall`
- `DataStatus = complete | partial | conflicting | unverified`
- `InclusionStatus = included | optional | excluded | needs_review`

数据状态口径：

- `complete`：开播日期、排期等关键资料齐全，且没有来源冲突。
- `partial`：关键资料缺失，例如无开播日期或无排期。
- `unverified`：匹配置信度不足，需要人工确认。
- `conflicting`：来源之间存在冲突。
- 缺 Bangumi 评分由 `missingRating` 独立统计，不得单独导致 `dataStatus="partial"`。

其他规则：

- 非日本动画必须写 `isJapaneseAnime=false`、`inclusionStatus="excluded"` 和 `exclusionReason`。
- 可展示条目至少保留一个 `sources[]`。
- 已完结或取消条目不再继承 `updateTime` / `updateWeekday`。
- `episodeCount` 与 `airedEpisodeCount` 不得矛盾。
- 巴哈姆特、YourAnimes、人工覆盖写入的展示时间按北京时间 `Asia/Shanghai` 处理。

## 6. API

`GET /api/anime`

- 参数：`year=YYYY`、`season=1|4|7|10`
- 可选：`includeOptional=false`、`includeNeedsReview=false`
- 默认包含 `included`、`optional`、`needs_review`
- 始终过滤非日本动画、excluded、非 TV 和成人内容

`POST /api/update`

```ts
{ year: number, season: 1 | 4 | 7 | 10, force?: boolean }
```

- Vercel 环境下默认只读：`process.env.VERCEL === "1"` 且 `ENABLE_VERCEL_UPDATE !== "true"` 时返回 403。
- 设置 `UPDATE_API_TOKEN` 后，请求必须提供 Bearer Token 或 `x-update-token`。

`GET /api/status`

- 返回更新状态、最近错误、缓存更新时间和缓存条目数。

## 7. 数据源与更新

数据源链路：

- Bangumi：主源，提供标题、subjectId、评分、封面、日期、集数、官网、制作公司等。
- 巴哈姆特：参考源，补充 UTC+8 / 北京时间更新时间。
- YourAnimes：低优先级参考源，补充日本首播时间和 Bangumi subjectId。
- `data/manual-broadcast-overrides.json`：最终人工覆盖，只对未完结、未取消条目生效。

更新入口：

```powershell
npm run data:update -- --year 2026 --season 7
npm run data:reconcile
npm run data:sync-bangumi
npm run data:validate
```

更新流程：

1. 校验 `year` 和 `season`。
2. 检查更新锁。
3. 拉取或读取 Bangumi、巴哈姆特、YourAnimes。
4. 归一化、去重、按 `primarySeason` 过滤目标季度。
5. 过滤 TV、日本动画、非成人内容。
6. 与旧缓存合并，保留可靠旧信息。
7. 应用人工广播覆盖。
8. 校验并写入 `data/anime.json`、`data/status.json`、`data/update-log.jsonl`。

失败策略：

- 写入前校验失败：不覆盖旧缓存。
- 外部源失败：记录 warning，尽量保留可用旧缓存。
- 目标季度无旧缓存，外部源也无可用条目但产生 warning：返回 `SOURCE_UNAVAILABLE`，不写入“空成功”。

## 8. 前端现状

前端是工具页，不是营销页。当前页面内容暂时保留，不要为部署修改页面。

当前特征：

- Material Design 取向的工具页风格。
- 顶部年份与季度选择。
- 统计列表与追番时间轴。
- 更新时间展示为北京时间。
- 更新完成弹窗展示完整、信息不完整、缺评分、来源冲突、过滤非日漫、外部源 warning 等审查信息。
- 更新失败弹窗展示错误代码、原因和详情。
- 移动端已做卡片式统计列表和追番时间轴优化。

## 9. 环境变量

本地常用：

```text
STORAGE_DRIVER=local-json
DATA_DIR=./data
UPDATE_LOCK_TTL_SECONDS=900
BANGUMI_SUBJECT_LIST_POWERSHELL_FALLBACK=true
BANGUMI_POWERSHELL_FALLBACK=false
BAHAMUT_ENABLED=true
YOURANIMES_ENABLED=true
MANUAL_BROADCAST_OVERRIDES_FILE=./data/manual-broadcast-overrides.json
UPDATE_API_TOKEN=
ENABLE_VERCEL_UPDATE=false
```

命令行脚本会读取 `.env.local` / `.env`；已有进程环境变量优先。

Vercel 简单公开部署建议：

- 不设置 `ENABLE_VERCEL_UPDATE=true`，保持线上 `/api/update` 默认禁用。
- 不需要设置 `UPDATE_API_TOKEN`，因为线上更新不开放。
- 不依赖 Vercel 函数写入本地 JSON 做持久更新。
- 公开内容来自随部署产物发布的 `data/*.json`。

## 10. 常用命令

```powershell
npm install
npm run dev:local
npm run test
npm run check
npm run build
```

部署前至少运行：

```powershell
npm run check
npm run build
```

## 11. Vercel 部署规则

当前目标是“只读公开网页”：

- 可以部署到 Vercel。
- 页面内容不需要为部署修改。
- `data/anime.json`、`data/status.json` 会随代码一起发布。
- 线上访问、筛选、查询可用。
- 线上手动更新默认不可用；要更新公开数据，应在本地更新 JSON 后重新部署。

如需线上自动更新，必须先接入外部持久化，例如对象存储、数据库或 KV；不能依赖 Vercel Serverless 写入项目内 JSON 文件。

## 12. 后续 AI 约束

必须：

- 先读本文件，再读相关代码。
- 以本文件当前规则和用户最新确认规则为准。
- 修改核心规则、部署方式或数据状态口径后同步更新本文件。
- 修改核心逻辑后运行 `npm run check`。
- 修改数据后运行 `npm run data:validate`。
- 保留用户未要求删除的文件和数据。

禁止：

- 不要恢复旧需求文档作为依据。
- 不要重新引入已排除数据源。
- 不要把当前季度续播提前显示到未来季度。
- 不要把缺评分单独判定为信息不完整。
- 不要把已完结或取消条目重新标成有固定更新时间。
