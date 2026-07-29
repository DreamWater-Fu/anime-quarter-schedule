# 项目手册：季度日本动漫更新时间表

最后更新：2026-07-29

本文件是后续 AI 和开发者理解、修改本项目的唯一入口。先读本文件，再读相关代码。修改项目目标、数据源、接口、数据模型、部署方式、季度归属规则或更新流程时，必须同步更新本文件。

## 1. 当前状态

- 当前版本：`0.1.1`
- 技术栈：Next.js App Router、React、TypeScript、Node.js `>=24`
- 存储：本地 JSON 文件
- 测试：Node.js 内置 test runner
- 当前缓存：`data/anime.json` 共 326 条，全部为 TV，日本动画，非 excluded，封面缺失为 0
- 当前验证：`npm run lint` 通过，`npm run test` 通过，`npm run build` 通过，91 个单元测试通过

## 2. 产品边界

本项目是个人使用的日本季度 TV 动漫更新时间表，用于查看季度番剧、更新时间、Bangumi 评分和数据状态。

必须遵守：

- 只展示日本 TV 动画。
- 不展示中国动画、中日合作动画、海外动画、非 TV 条目、R18/NSFW/成人内容。
- 不展示 `isJapaneseAnime=false` 或 `inclusionStatus="excluded"` 条目。
- 默认包含 `included`、`optional` 和 `needs_review`。
- 缺失值用 `null`，不要用空字符串、`N/A` 或 `0` 占位。
- 巴哈姆特、YourAnimes 和人工覆盖写入的展示时间按北京时间处理，即 `Asia/Shanghai`。
- 不要重新引入 Syoboi、AniList、中国动画数据源、官方站批量爬虫或海外动画数据源。

## 3. 季度归属规则

番剧所属季度只由开播日期决定，不由终播日期、最后一集日期或排期覆盖决定。

季度宽限窗口：

- 3 月 18 日至 6 月 16 日开播：四月新番
- 6 月 17 日至 9 月 16 日开播：七月新番
- 9 月 17 日至 12 月 17 日开播：十月新番
- 12 月 18 日至次年 3 月 17 日开播：下一年一月新番

实现位置：

- `src/server/anime/calculateSeason.ts`
- `calculatePrimarySeason`
- `getCurrentSeasonKey`

`primarySeason` 是唯一归属依据。`activeSeasons` 只表示排期覆盖和续播元数据。

续播展示规则：

- 请求季度等于当前北京时间实际季度时，可用 `activeSeasons` 辅助展示仍在播的旧季度条目。
- 请求未来季度时，不允许因为 `activeSeasons` 提前显示当前季度仍在播的作品。
- 例：当前仍是 2026 年七月新番时期时，七月番即使排期延伸到 10 月，也不能出现在 2026 年十月新番页。

## 4. 目录速览

```text
app/
  page.tsx
  api/anime/route.ts
  api/status/route.ts
  api/update/route.ts

src/app/
  components/
  lib/

src/server/
  anime/              查询、季度计算、更新编排、校验
  api/                API 适配层
  cache/              本地 JSON 存储和状态缓存
  config/             本地环境变量加载
  sources/bangumi/    Bangumi 客户端、映射、匹配
  sources/bahamut/    巴哈姆特参考源
  sources/youranimes/ YourAnimes 参考源
  types/              核心类型

data/
  anime.json
  status.json
  update-log.jsonl
  manual-broadcast-overrides.json
  bahamut-references.json
  bahamut-timetable.html
  youranimes-YYYYMM.html
  bangumi-YYYYMM-subjects.json

scripts/
  init-data.ts
  update-season.ts
  reconcile-current-cache.ts
  sync-bangumi-details.ts
  validate-cache.ts
  api-smoke.ts

tests/
  fixtures/
  unit/
```

## 5. 核心数据模型

核心类型在 `src/server/types/anime.ts`。

关键类型：

- `SeasonMonth = 1 | 4 | 7 | 10`
- `AnimeQuarter = winter | spring | summer | fall`
- `AnimeTimezone = "Asia/Tokyo" | "Asia/Shanghai"`
- `DataStatus = complete | partial | conflicting | unverified`
- `InclusionStatus = included | optional | excluded | needs_review`

重要字段规则：

- 非日本动画必须标记 `isJapaneseAnime=false`、`inclusionStatus="excluded"`，并写明 `exclusionReason`。
- 可展示条目至少保留一个 `sources[]`。
- Bangumi 信息保留 `subjectId`、`url`、`rating`、`ratingCount`、`rank`、`lastSyncedAt`。
- `complete` 表示开播日期、排期等关键资料齐全且无来源冲突；缺 Bangumi 评分由 `missingRating` 单独统计，不得单独导致 `dataStatus="partial"`。
- 已完结或已取消条目不再继承 `updateTime` / `updateWeekday`。
- `episodeCount` 和 `airedEpisodeCount` 不得互相矛盾。

## 6. API 契约

### `GET /api/anime`

参数：

- `year=YYYY`
- `season=1|4|7|10`
- `includeOptional=false`
- `includeNeedsReview=false`

默认行为：

- `includeOptional` 默认 `true`
- `includeNeedsReview` 默认 `true`
- 只有参数精确为 `false` 时才隐藏对应条目
- 始终过滤非日本动画、excluded、非 TV 和成人内容

成功响应：

```ts
{ ok: true, data: AnimeSeasonPayload }
```

失败响应：

```ts
{ ok: false, error: PublicApiError }
```

### `POST /api/update`

请求体：

```ts
{ year: number, season: 1 | 4 | 7 | 10, force?: boolean }
```

保护规则：

- `process.env.VERCEL === "1"` 且 `ENABLE_VERCEL_UPDATE !== "true"` 时返回 403。
- 设置 `UPDATE_API_TOKEN` 后，请求必须提供 Bearer Token 或 `x-update-token`。

### `GET /api/status`

返回当前更新状态、最近错误、缓存更新时间和条目数。

## 7. 数据源

### Bangumi

主数据源。负责标题、别名、subject ID、评分、评分人数、排名、封面、放送日期、集数、官网、制作公司等。

规则：

- 高置信匹配才自动绑定。
- 低置信结果保持未验证或人工复核。
- 请求失败记录 warning；有旧缓存或其他参考源时尽量不中断更新。
- 支持 `data/bangumi-YYYYMM-subjects.json` 本地月度缓存。
- Windows 上可用月度 subject list PowerShell fallback，逐详情 fallback 默认关闭。

### 巴哈姆特

补充更新时间表。时间按 UTC+8 / 北京时间写入。

规则：

- 默认可由 `BAHAMUT_ENABLED=true` 启用。
- 可读本地参考 JSON、本地 HTML、配置 URL 或内置候选 URL。
- 失败只记录 warning，不阻断 Bangumi 更新。

### YourAnimes

低优先级日本播出时间参考源。只用于补充日本首播时间和 Bangumi subjectId。

规则：

- 默认可由 `YOURANIMES_ENABLED=true` 启用。
- 可读 `data/youranimes-YYYYMM.html` 或动态 URL `https://youranimes.tw/bangumi/YYYYMM`。
- 隐式默认本地文件不存在时静默跳过；显式配置文件缺失才 warning。
- 已读到本地季度缓存时，不再请求在线 URL。
- 只有带 Bangumi subjectId 的参考条目可进入候选。
- 不得覆盖 Bangumi 评分、封面、集数和已推断完结状态。

### 人工广播覆盖

文件：`data/manual-broadcast-overrides.json`

规则：

- 作为最后兜底来源。
- 按 `id` 匹配现有条目。
- 写入 `timezone: "Asia/Shanghai"`。
- 只对未完结、未取消条目生效。
- 修改后建议运行 `npm run data:reconcile` 和 `npm run data:validate`。

## 8. 更新流程

入口：

- 命令行：`npm run data:update -- --year 2026 --season 7`
- API：`POST /api/update`

流程摘要：

1. 校验 `year` 和 `season`。
2. 检查更新锁；超过 `UPDATE_LOCK_TTL_SECONDS` 的 running 状态可释放。
3. 拉取或读取 Bangumi。
4. 拉取或读取巴哈姆特。
5. 拉取或读取 YourAnimes。
6. 归一化外部数据。
7. 合并重复条目。
8. 按 `primarySeason` 过滤到目标季度。
9. 过滤 TV、日本动画、非成人内容。
10. 和旧缓存合并，保留已同步的 Bangumi 详情、评分、封面、集数和完结状态。
11. 对未完结条目应用人工广播覆盖。
12. 校验缓存。
13. 写入 `data/anime.json`、`data/status.json`、`data/update-log.jsonl`。

失败策略：

- 写入前校验失败：不覆盖旧 `anime.json`。
- Bangumi、巴哈姆特、YourAnimes 网络或结构失败：记录 warning，尽量保留可用旧缓存。
- 目标季度没有旧缓存，且外部源没有返回任何可用条目但产生了 warning 时：返回 `SOURCE_UNAVAILABLE`，不写入空成功，避免把网络或数据源不可用误判为“季度确实为空”。
- 外部源 warning 必须在更新完成弹窗展示。

## 9. 前端行为

前端是工具页，不是营销页。

核心组件：

- `AnimeSchedulePage`
- `ScheduleToolbar`
- `ScheduleControls`
- `StatusSummary`
- `ScheduleBoard`
- `AnimeTable`
- `FollowSchedule`
- `BangumiBadge`
- `DataStatusBadge`
- `CoverImage`
- `StateView`

规则：

- 默认展示当前季度可用条目。
- 常态页面只展示 TV 动画，不提供 WEB、OVA、MOVIE、SP 类型筛选。
- 必须有加载、错误、空数据和部分数据状态。
- Bangumi 评分人数未知时不要显示 `0`。
- 更新时间展示为北京时间。
- 常态摘要只显示当前季度番剧数量。
- 完整、信息不完整、缺评分、来源冲突、过滤非日漫等审查结果只在更新完成弹窗显示。
- 更新失败弹窗必须显示错误代码、错误原因和详情。
- 更新成功但外部来源失败时，完成弹窗必须显示 warning。

## 10. 环境变量

```text
STORAGE_DRIVER=local-json
DATA_DIR=./data
UPDATE_LOCK_TTL_SECONDS=900

BANGUMI_API_BASE_URL=
BANGUMI_USER_AGENT=
BANGUMI_ACCESS_TOKEN=
BANGUMI_RATE_LIMIT_PER_MINUTE=
BANGUMI_SUBJECT_LIST_POWERSHELL_FALLBACK=true
BANGUMI_POWERSHELL_FALLBACK=false

BAHAMUT_ENABLED=true
BAHAMUT_REFERENCES_FILE=
BAHAMUT_TIMETABLE_URLS=
BAHAMUT_TIMETABLE_FILES=
BAHAMUT_USER_AGENT=
BAHAMUT_TIMEOUT_MS=
BAHAMUT_RATE_LIMIT_PER_MINUTE=

YOURANIMES_ENABLED=true
YOURANIMES_TIMETABLE_URLS=
YOURANIMES_TIMETABLE_FILES=
YOURANIMES_USER_AGENT=
YOURANIMES_TIMEOUT_MS=

MANUAL_BROADCAST_OVERRIDES_FILE=./data/manual-broadcast-overrides.json

UPDATE_API_TOKEN=
ENABLE_VERCEL_UPDATE=false
```

命令行脚本会显式读取 `.env.local` / `.env`；已有进程环境变量优先级更高。

## 11. 常用命令

首次运行：

```powershell
npm install
Copy-Item .env.example .env.local
npm run data:init
npm run dev:local
```

数据更新：

```powershell
npm run data:update -- --year 2026 --season 7
npm run data:reconcile
npm run data:sync-bangumi
npm run data:validate
```

质量检查：

```powershell
npm run test
npm run check
npm run build
```

## 12. 部署规则

- Vercel 线上环境默认只读。
- 静态 JSON 数据可以随部署产物发布。
- 不依赖 Vercel Serverless 写入本地文件实现持久更新。
- 线上 `/api/update` 默认禁用。
- 只有显式设置 `ENABLE_VERCEL_UPDATE=true` 且鉴权通过时，才允许线上更新尝试。
- 如需线上自动更新，必须先引入外部持久化，例如对象存储、数据库或 KV。

## 13. 测试与质量门禁

已有测试覆盖：

- 季度计算和当前季度续播判断
- 查询与 API 基础行为
- 数据校验
- 更新流程和回滚
- Bangumi 映射与匹配
- 巴哈姆特适配
- YourAnimes 适配
- 状态缓存
- 前端筛选、排序、更新时间展示辅助逻辑

修改核心逻辑后必须至少运行：

```powershell
npm run test
npm run check
```

修改数据后必须运行：

```powershell
npm run data:validate
```

涉及构建、Next 配置或前端页面时运行：

```powershell
npm run build
```

## 14. 后续 AI 工作规则

必须：

- 先读本文件，再读相关代码。
- 以本文件当前规则和用户最新确认规则为准。
- 修改核心规则后同步更新本文件。
- 修改核心逻辑后运行测试和构建检查。
- 数据更新后运行缓存校验。
- 保留用户未要求删除的文件和数据。

禁止：

- 不要恢复旧需求文档作为依据。
- 不要重新引入 Syoboi、AniList 或其他已排除数据源。
- 不要把中国动画、中日合作动画或海外动画纳入默认展示。
- 不要把巴哈姆特、YourAnimes 或人工覆盖时间误标为日本时间。
- 不要因为 `activeSeasons` 把当前季度续播提前显示到未来季度。
- 不要把已完结或取消条目重新标成有固定更新时间。

## 15. 当前风险

- 非日本动画识别仍可能误判，需要持续校验 Bangumi 字段和人工排除规则。
- Bangumi、巴哈姆特、YourAnimes 可能超时、限流、字段变化、页面结构变化或地区不可达。
- Vercel 线上更新不能依赖本地 JSON 写入持久化。
- 暂无端到端浏览器测试。
- 中文路径下部分 Git 或 PowerShell 命令可能有编码/路径问题。

## 16. 最近有效变更

只保留对当前实现有指导意义的记录；旧流水账不要作为当前规则来源。

### 2026-07-29：数据完整性口径修正

- 缺 Bangumi 评分不再单独导致 `dataStatus="partial"`。
- Bangumi 条目只要开播日期、排期齐全且无集数或来源冲突，可标记为 `complete`。
- `missingRating` 继续作为独立统计项展示，不并入“信息不完整”的数据状态判定。

### 2026-07-29：前端状态展示与移动端可用性优化

- 前端筛选新增 `dataStatus` 维度，可按完整、信息缺失、待确认、来源冲突筛选。
- 统计列表新增数据状态列；追番列表在作品信息中同步显示数据状态徽标。
- 小屏统计列表改为卡片式行展示，字段标签直接出现在每条记录内，避免移动端依赖横向滚动。
- 更新完成弹窗中的外部来源 warning 显示 source、code、HTTP status 和 details；更新失败弹窗显示错误代码、错误原因和错误详情缺省提示。
- 年份输入改为本地草稿校验，只有 1900-2100 的有效年份才触发查询和 URL 更新。
- 新增本地 `app/icon.svg` 并在 metadata 中声明，减少浏览器默认 favicon 404 噪声。
- 验证：`npm run lint`、`npm run test`、`npm run build` 通过；Playwright 预览桌面与 390px 移动端，移动端横向溢出检查为 `false`。

### 2026-07-29：开播月份归属与当前季度续播判断

- 修复 7 月新番提前出现在 10 月新番页的问题。
- `calculatePrimarySeason` 改为按开播日期和两周宽限窗口计算归属季度。
- 新增 `getCurrentSeasonKey`，按北京时间判断当前实际季度。
- `queryAnimeBySeason` 仅在请求季度等于当前实际季度时，允许 `activeSeasons` 命中的旧季度条目作为续播展示。
- 验证：以 `2026-07-29` 查询，2026 年 10 月页返回 4 条，不包含 7 月首播续播条目；以 `2026-10-10` 查询，10 月页可显示当时实际续播条目。
- 验证：`npm run test`、`npm run check`、`npm run build` 通过，91 个单元测试通过。

### 2026-07-29：projectmanual 自检精简

- 将手册从历史流水账压缩为当前规则优先的 AI 可读规范。
- 保留当前数据源、季度规则、查询规则、更新流程、环境变量、命令、风险和最近有效变更。
- 明确旧历史记录不得覆盖当前规则。

### 2026-07-29：历史季度更新失败语义

- 修复历史季度无旧缓存时，外部源不可用却可能表现成“成功更新 0 条”的模糊状态。
- `updateAnimeData` 现在会在目标季度没有旧缓存、外部源返回 warning 且无可用条目时抛出 `SOURCE_UNAVAILABLE`。
- 目标季度已有旧缓存时，外部源失败仍可按旧缓存完成刷新并记录 warning。
- 验证：新增更新流程单测覆盖无旧缓存失败场景。

### 2026-07-29：当前数据源与缓存基线

- 数据源链路为 Bangumi、巴哈姆特、YourAnimes、人工广播覆盖。
- 当前缓存已扩展到 2025 年 7 月和 2026 年四个季度相关数据，共 326 条。
- 当前缓存全部为 TV，日本动画，非 excluded，封面缺失为 0。
- 2025 年 7 月历史条目已按完结优先规则清理更新时间残留。
