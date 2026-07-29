# 项目手册：季度日本动漫更新时间表

最后更新：2026-07-29

本文件是后续 AI 和开发者理解、迭代本项目的唯一项目手册。修改项目目标、数据源、接口、数据模型、部署方式或核心流程时，必须同步更新本文件。

当前版本状态：`0.1.0`，项目手册自检修复已完成；最近验证为 2026 四季度更新自测、`npm run check`、`npm run build` 和本地 API 自测通过；仍需关注本机网络访问 Bangumi/巴哈姆特失败带来的来源 warning。

## 1. 项目定位

本项目是一个面向个人使用的日本季度动漫更新时间表工具，用于查看当前季度日本动画的播出、更新、Bangumi 评分和数据状态。

当前产品目标：

- 只考虑日本动漫。
- 不考虑中国动画、中日合作动画、海外动画或其他非日本动画。
- 非日本动画不再保留在 `data/anime.json` 缓存中；更新流程识别后直接跳过，不写入缓存。
- 默认展示本季所有有效条目，包括 `included`、`optional` 和 `needs_review`。
- 永远不展示 `excluded` 或明确判定为非日本动画的条目。
- 使用 Bangumi 填入条目元数据、评分、排名、封面和集数信息。
- 使用巴哈姆特补充番剧更新时间表。
- Bangumi 当前强依赖内容主要是评分、评分人数、排名和 subject 元数据；首播时间、更新日期和更新时间可由 Bangumi、巴哈姆特或旧缓存共同提供。
- 巴哈姆特时间按北京时间处理和展示，即 `Asia/Shanghai`。
- Vercel 线上环境以只读静态快照为主；手动更新主要由本地或唯一授权客户端执行。

## 2. 技术栈

- 框架：Next.js App Router
- UI：React
- 语言：TypeScript
- 运行环境：Node.js，`package.json` 当前要求 `>=24`
- 数据存储：本地 JSON 文件
- 测试：Node.js 内置 test runner
- 外部数据源：Bangumi API、巴哈姆特参考数据或页面

关键脚本见 `package.json`：

```bash
npm run dev
npm run build
npm run test
npm run check
npm run data:init
npm run data:update
npm run data:validate
npm run api:smoke
```

## 3. 目录结构与职责

```text
app/
  page.tsx                    前端入口页面
  api/anime/route.ts          番剧查询接口
  api/status/route.ts         更新状态查询接口
  api/update/route.ts         手动更新接口

src/app/
  components/                 前端组件
  lib/                        前端格式化、筛选、展示辅助逻辑

src/server/
  anime/                      番剧查询、季度计算、更新编排、校验逻辑
  cache/                      本地 JSON 存储、状态缓存、原子写入
  sources/bangumi/            Bangumi 客户端、映射、匹配逻辑
  sources/bahamut/            巴哈姆特数据适配逻辑
  types/                      后端核心类型定义

data/
  anime.json                  当前缓存的番剧数据
  status.json                 当前更新状态
  update-log.jsonl            更新日志
  bahamut-references.json     巴哈姆特手动参考数据
  bahamut-timetable.html      巴哈姆特页面样例或本地输入

scripts/
  init-data.ts                初始化本地数据文件
  update-season.ts            命令行手动更新
  validate-cache.ts           校验缓存数据
  api-smoke.ts                API 冒烟检查

tests/
  fixtures/                   测试夹具
  unit/                       单元测试
```

## 4. 核心数据模型

核心类型位于 `src/server/types/anime.ts`。

重要枚举和约定：

- `SeasonMonth = 1 | 4 | 7 | 10`
- `AnimeQuarter = winter | spring | summer | fall`
- `AnimeTimezone = "Asia/Tokyo" | "Asia/Shanghai"`
- `DataStatus = complete | partial | conflicting | unverified`
- `InclusionStatus = included | optional | excluded | needs_review`

数据模型规则：

- 缺失值使用 `null`，不要用空字符串、`N/A`、`0` 等占位值。
- 非日本动画必须标记：
  - `isJapaneseAnime = false`
  - `inclusionStatus = "excluded"`
  - `exclusionReason` 写明排除原因
- 可展示条目应至少有一个 `sources[]`。
- 排期信息应尽量记录来源字段，例如 Bangumi 或 Bahamut。
- 巴哈姆特写入的更新时间必须带 `timezone: "Asia/Shanghai"`。
- Bangumi 信息应保留 `subjectId`、`url`、`rating`、`ratingCount`、`rank`、`lastSyncedAt`。

## 5. API 契约

### `GET /api/anime`

查询季度番剧数据。

常用参数：

- `year=YYYY`
- `season=1|4|7|10`
- `includeOptional=false`
- `includeNeedsReview=false`

当前默认行为：

- `includeOptional` 默认 `true`。
- `includeNeedsReview` 默认 `true`。
- 只有当查询参数精确为 `false` 时才隐藏对应条目。
- 后端始终过滤 `isJapaneseAnime=false` 和 `inclusionStatus="excluded"`。

响应格式：

```ts
{
  ok: true,
  data: AnimeSeasonPayload
}
```

失败时：

```ts
{
  ok: false,
  error: string
}
```

### `POST /api/update`

手动触发季度数据更新。

请求体：

```ts
{
  year: number,
  season: 1 | 4 | 7 | 10,
  force?: boolean
}
```

线上保护：

- 当 `process.env.VERCEL === "1"` 且 `ENABLE_VERCEL_UPDATE !== "true"` 时，接口返回 403。
- 如果设置了 `UPDATE_API_TOKEN`，请求必须提供 Bearer Token 或 `x-update-token`。

### `GET /api/status`

返回当前更新状态、最近错误、缓存更新时间等状态信息。

## 6. 数据源规则

### Bangumi

Bangumi 是当前主数据源。

负责提供：

- 条目标题、中文名、别名
- Bangumi subject ID 和 URL
- 评分、评分人数、排名
- 封面
- 放送日期和集数日期
- 官方站、制作公司、条目类型等辅助匹配信息

注意事项：

- Bangumi 请求失败属于高风险更新失败。
- Bangumi 匹配逻辑应优先使用稳定字段，例如 subject ID、标题归一化、日期、格式、集数、官网和制作公司。
- 只有高置信匹配可以自动绑定；低置信结果应保持未验证或人工复核状态。
- 对非日本动画的过滤仍带有启发式成分，需要长期人工校验。

### 巴哈姆特

巴哈姆特是更新时间表补充源。

负责提供：

- 番剧更新日期
- 更新时间
- 巴哈姆特播放页或参考链接
- 可选的 Bangumi subject ID 对应关系

时间规则：

- 巴哈姆特时间按 UTC+8 处理。
- 写入数据时使用 `timezone: "Asia/Shanghai"`。
- 前端展示时应提示或表达为北京时间。

运行规则：

- 默认可通过 `BAHAMUT_ENABLED=true` 启用。
- 可读取 `data/bahamut-references.json`、本地 HTML 文件、配置的 URL，或当前实现内置的季度默认候选 URL。
- 当前内置默认候选 URL 覆盖 `2026-7`，用于点击更新时自动尝试读取巴哈姆特动画疯季度时间表。
- 若巴哈姆特页面拒绝抓取或结构变化，更新流程应记录 warning 并继续保留 Bangumi 数据。
- 巴哈姆特失败不应导致整个更新流程失败，应记录 warning 并保留 Bangumi 数据。

### 不接入的数据源

当前决策明确不接入：

- Syoboi
- AniList
- 中国动画数据源
- 官方站批量爬虫
- 海外动画数据源

如果未来要改变该规则，必须先更新本手册，再修改实现。

## 7. 数据流与更新流程

更新入口：

- 命令行：`npm run data:update -- --year 2026 --season 7`
- API：`POST /api/update`

更新流程：

1. 校验 `year` 和 `season`。
2. 检查更新锁和当前状态。
3. 如果存在过期 running 状态，按 `UPDATE_LOCK_TTL_SECONDS` 释放。
4. 拉取 Bangumi 数据。
5. 在启用时拉取或读取巴哈姆特数据。
6. 归一化外部数据。
7. 合并重复条目。
8. 过滤到目标季度。
9. 和已有缓存条目合并。
10. 校验缓存结构。
11. 校验通过后写入 `data/anime.json`。
12. 写入 `data/status.json` 和 `data/update-log.jsonl`。

失败策略：

- Bangumi 失败：记录 warning；若当前季度已有旧缓存或巴哈姆特可用数据，则继续完成更新，保留旧 Bangumi 评分并继续审查排期。
- 巴哈姆特失败：记录 warning，不阻断 Bangumi 更新。
- 写入前校验失败：不覆盖旧 `anime.json`。
- 运行锁卡死：超过 TTL 后允许释放并重试。

## 8. 查询与排序规则

查询逻辑位于 `src/server/anime/queryAnime.ts`。

核心规则：

- 使用 `primarySeason` 判断条目是否属于目标季度，季度列表表示首播季度，而不是最后一集或跨季播出覆盖。
- `activeSeasons` 只保留为排期覆盖和续播状态元数据，不作为默认季度归档依据，避免 7 月首播且最后一集落在 10 月初的作品被误显示为十月番。
- 默认包含 `optional` 和 `needs_review`。
- 始终排除非日本动画和 `excluded`。
- 排序优先级通常为更新时间、开播日期、标题。

## 9. 前端行为

前端目标是工具型页面，而不是宣传落地页。

当前核心组件：

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

体验规则：

- 默认展示当前季度可用条目。
- 必须有加载、错误、空数据和部分数据状态。
- Bangumi 评分人数未知时不要显示 `0`。
- 巴哈姆特更新时间展示为北京时间。
- 筛选项应覆盖 TV、WEB、OVA、MOVIE、SP 等格式。
- 页面应优先服务查询、筛选、排序、追番和检查数据状态。
- 页面常态摘要只显示当前季度番剧数量；完整、信息不完整、缺评分、来源冲突和过滤非日漫等更新审查结果只在更新完成弹窗中显示。
- 更新失败时必须弹窗显示错误代码、错误原因和详情；更新成功但外部来源失败时，更新完成弹窗必须显示外部来源 warning。

## 10. 本地运行

推荐首次运行：

```powershell
npm install
Copy-Item .env.example .env.local
npm run data:init
npm run dev
```

常用数据更新：

```powershell
npm run data:update -- --year 2026 --season 7
npm run data:validate
```

质量检查：

```powershell
npm run test
npm run check
npm run build
```

最近一次已知检查结果：

- `npm run check` 通过。
- `npm run build` 通过。
- 单元测试通过，当前已知为 73 个测试。
- 当前缓存约 103 个条目，已删除当前已知非日本动画和 `excluded` 条目。

## 11. 环境变量

核心环境变量：

```text
STORAGE_DRIVER=local-json
DATA_DIR=./data
UPDATE_LOCK_TTL_SECONDS=900

BANGUMI_API_BASE_URL=
BANGUMI_USER_AGENT=
BANGUMI_ACCESS_TOKEN=
BANGUMI_RATE_LIMIT_PER_MINUTE=

BAHAMUT_ENABLED=true
BAHAMUT_REFERENCES_FILE=
BAHAMUT_TIMETABLE_URLS=
BAHAMUT_TIMETABLE_FILES=
BAHAMUT_USER_AGENT=
BAHAMUT_TIMEOUT_MS=
BAHAMUT_RATE_LIMIT_PER_MINUTE=

UPDATE_API_TOKEN=
ENABLE_VERCEL_UPDATE=false
```

注意：

- `.env.local` 会由本项目的命令行脚本显式读取；已经存在的进程环境变量优先级更高。
- `.env.example` 不应再保留 Syoboi、AniList 或其他未接入数据源的占位变量。
- 当前项目基线只允许 Bangumi 和巴哈姆特作为数据源。

## 12. Vercel 与部署规则

当前部署取舍：

- Vercel 线上环境默认只读。
- 静态 JSON 数据可以随部署产物一起发布。
- 不依赖 Vercel Serverless 写入本地文件实现持久更新。
- 线上 `/api/update` 默认禁用。
- 只有显式设置 `ENABLE_VERCEL_UPDATE=true` 且鉴权通过时，才允许尝试线上更新。

重要风险：

- Vercel Serverless 本地文件写入不可作为持久化方案。
- 如果未来需要线上自动更新，必须引入外部持久化，例如对象存储、数据库或 KV。
- 外部数据源请求可能触发超时、限流、字段变化或地区限制。

## 13. 测试与质量门禁

当前已有测试覆盖：

- 季度计算
- 数据查询
- 数据校验
- 更新流程
- Bangumi 映射
- Bangumi 匹配
- 巴哈姆特适配
- 状态缓存
- API 基础行为

每次修改核心逻辑后建议运行：

```powershell
npm run test
npm run check
npm run build
```

数据更新后建议运行：

```powershell
npm run data:validate
```

当前缺口：

- 暂无端到端浏览器测试。
- 外部数据正确性仍需要 fixtures 和人工抽样共同保证。
- Bangumi 与巴哈姆特匹配误差需要长期积累人工反馈。

## 14. 已知风险与待办

高优先级：

- 非日本动画识别仍可能误判，需要持续校验 Bangumi 字段和人工排除规则。
- 巴哈姆特页面结构或字段变化可能导致更新时间解析失败。
- Vercel 线上更新不能依赖本地 JSON 写入持久化。

中优先级：

- 可增加端到端测试覆盖移动端、筛选、错误和空数据状态。
- 可增加更多外部数据 fixtures，降低真实接口变化带来的不确定性。
- 中文路径下部分 Git 命令可能出现编码或路径问题，排查时注意 PowerShell 工作目录和字符集。

低优先级：

- 前端可继续优化移动端密度和表格可读性。
- 可增加数据差异报告，帮助人工审核每次更新新增、删除和匹配变化。

## 15. 最近迭代记录

### 2026-07-29

- 根据实测反馈复查 `擅长逃跑的殿下 第二季` 与 `暗芝居 第十七季`：未发现延期到 10 月的公开依据，误显示为十月番的原因是 `activeSeasons` 根据最后一集跨入 10 月生成，前后端已改为按 `primarySeason` 首播季度归档。
- 前端更新时间列取消“下一季续播”优先展示，跨季播出的 7 月番仍显示每周更新时间，不再把最后一集日期误读为所属季度。
- 更新流程改为按首播季度写入和回退；当目标季度暂无候选且外部来源不可达时，更新成功返回 0 条并记录 warning，不再产生硬失败错误报告。
- 更新合并逻辑增强：当新抓取数据缺少 `updateTime` 时，保留旧缓存中已核实的更新时间、星期和时区，避免后续点击更新冲掉人工或官方补录时间。
- 为 `擅长逃跑的殿下 第二季` 补录官方播出时间：日本时间周五 23:30，落库为北京时间周五 22:30；来源记录为 `https://nigewaka.run/`。
- 为 `暗芝居 第十七季` 补录电视东京节目表时间：日本时间周日 27:20，落库为北京时间周一 02:20；来源记录为 `https://www.tv-tokyo.co.jp/broad_tvtokyo/program/detail/202607/22806_202607122720.html`。
- 已实际运行 2026 年 1 月、4 月、7 月、10 月四个季度更新：四次均成功；当前本机环境仍对 Bangumi API 和 2026 年 7 月巴哈姆特候选 URL 返回网络 fetch failed warning。
- 最近验证命令：`npm run check` 通过，`npm run build` 通过；本地 API 自测确认 2026 年 7 月季返回 49 条且包含两部补录时间作品，2026 年 10 月季返回 0 条且不包含这两部作品。
- 本次修改文件：`src/server/anime/queryAnime.ts`、`src/server/anime/updateAnimeData.ts`、`src/app/lib/format.ts`、`tests/unit/api-cache.test.ts`、`tests/unit/frontend-state.test.ts`、`tests/unit/quarter-api.test.ts`、`tests/unit/update-flow-fixtures.test.ts`、`data/anime.json`、`data/status.json`、`PROJECT_MANUAL.md`。

- 根据实测反馈清理当前缓存中的非日本动画，删除 `Ninjago/幻影忍者`、`新大头儿子和小头爸爸`、`喜羊羊`、`超能猩云队` 等当前已知非日漫及所有 `excluded` 条目；当前 `data/anime.json` 为 105 条。
- 根据实测反馈继续清理 `汪汪队立大功`、`柯蒂斯总统`，并补充 Paw Patrol、Curtis 等显式非日漫排除规则；当前 `data/anime.json` 为 103 条。
- 调整更新策略：Bangumi 失败不再直接导致整次更新失败，若当前季度已有旧缓存则用旧缓存作为基线，并继续尝试巴哈姆特排期审查。
- 巴哈姆特适配器改为默认启用，未设置 `.env.local` 时仍会读取 `data/bahamut-timetable.html` 并尝试内置季度候选 URL。
- 更新结果 API 增加 `warnings`，前端更新完成弹窗会展示 Bangumi/Bahamut 外部来源失败原因；更新失败时增加明显错误弹窗。
- 已实际运行 2026 年四个季度更新：1 月、4 月、7 月、10 月季度均成功；日志显示当前环境仍无法连接 Bangumi，2026 年 7 月巴哈姆特候选 URL 也出现网络抓取失败，但流程已降级为旧缓存基线并完成更新。
- 最近验证更新为 `npm run check` 通过、`npm run build` 通过、73 个单元测试通过、缓存校验 103 条通过。
- 更新流程改为跳过非日本动画和 `excluded` 条目，不再写入缓存；更新结果新增 `skippedNonJapanese` 和 `incomplete` 摘要字段。
- 增强 Bangumi 非日漫识别规则，补充 LEGO/Ninjago、大头儿子小头爸爸、无涯之约等显式排除模式。
- 增强巴哈姆特时间表读取：内置 `2026-7` 默认候选 URL，支持日期标题后跟时间/标题行，并支持单数字分钟归一化。
- 增强巴哈姆特与 Bangumi 合并：无 Bangumi subjectId 时可通过中文标题、原名和别名安全合并更新时间。
- 调整前端摘要：常态只显示当前番剧数量；信息完整/不完整、缺评分、冲突和过滤非日漫只在更新完成弹窗显示。
- 安装后续可用 skills：`playwright`、`screenshot`、`vercel-deploy`，用于后续浏览器自测、截图定位和部署检查。
- 按项目负责人确认，删除早期兼容字段 `externalIds.syoboiTid`、`externalIds.anilistId` 和 `coverImage.source="anilist"`。
- 同步清理源码映射、合并逻辑、测试对象、测试夹具、当前缓存和备份缓存中的旧字段。
- 将测试中的历史 Syoboi 示例源替换为通用官方排期示例，避免误导后续实现恢复未接入数据源。
- 完成本次基于项目手册的实现自检与修复。
- 增加命令行脚本 `.env.local` / `.env` 加载逻辑，修复 `npm run data:*` 不能读取本地环境变量配置的风险。
- 清理 `.env.example` 中 Syoboi、AniList、数据库和未实现更新配置占位，保持当前基线只接入 Bangumi 与巴哈姆特。
- 统一环境变量文档为 `BANGUMI_RATE_LIMIT_PER_MINUTE` 和 `BAHAMUT_RATE_LIMIT_PER_MINUTE`。
- 为巴哈姆特 URL 抓取实现 `BAHAMUT_RATE_LIMIT_PER_MINUTE` 限流。
- 增加本地环境变量加载器单元测试，测试数更新为 67 个。
- 本次新增文件：`src/server/config/env.ts`、`tests/unit/env-loader.test.ts`。
- 本次修改文件：`.env.example`、`scripts/init-data.ts`、`scripts/update-season.ts`、`scripts/validate-cache.ts`、`scripts/api-smoke.ts`、`src/server/types/anime.ts`、`src/server/anime/updateAnimeData.ts`、`src/server/sources/bangumi/adapter.ts`、`src/server/sources/bangumi/mapper.ts`、`src/server/sources/bahamut/adapter.ts`、`tests/unit/api-cache.test.ts`、`tests/unit/bangumi-fixtures.test.ts`、`tests/unit/bangumi-matcher.test.ts`、`tests/unit/season.test.ts`、`tests/unit/update-flow-fixtures.test.ts`、`tests/fixtures/anime-cache.base.json`、`data/anime.json`、`data/anime.json.bak`、`PROJECT_MANUAL.md`。
- 明确项目只服务日本动漫。
- 明确只接入 Bangumi 和巴哈姆特。
- 明确 Bangumi 用于评分、元数据和条目基础信息。
- 明确巴哈姆特用于更新时间表，时间按北京时间展示。
- 默认展示本季所有有效条目，包括 optional 和 needs_review。
- 明确 Vercel 线上只读静态存储，手动更新由本地或唯一授权客户端执行。
- 增加 `AnimeTimezone`，支持 `Asia/Tokyo` 和 `Asia/Shanghai`。
- 调整查询默认行为，默认包含 optional 和 needs_review。
- 增强 Bangumi 映射字段和非日本动画排除规则。
- 调整巴哈姆特适配器，将时间写为 `Asia/Shanghai`。
- 增加 Vercel 更新保护、更新鉴权和 stale lock TTL。
- 前端补充北京时间提示、格式筛选和数据状态摘要。
- 删除过期 Markdown 草稿，建立本项目手册作为后续唯一文档入口。

## 16. 后续 AI 工作规则

后续 AI 在修改本项目时必须遵守：

1. 先阅读本文件，再读相关代码。
2. 不要恢复已删除的旧需求文档。
3. 不要根据旧文档或历史变量重新引入 Syoboi、AniList 或其他数据源。
4. 不要把中国动画、中日合作动画或海外动画纳入默认展示。
5. 不要把巴哈姆特时间误标为日本时间。
6. 修改数据模型、API、更新流程、数据源规则或部署策略时，同步更新本文件。
7. 修改核心逻辑后运行测试和构建检查。
8. 数据更新后运行缓存校验。
9. 遇到来源冲突时，以本手册和用户最新确认规则为准。

## 17. 追加版本记录：2026-07-29 实测反馈修复

本节为追加记录，不改写前文历史内容。当前版本状态更新为 `0.1.1`：已完成本轮针对 2026 年四个季度实际更新、非日漫过滤、北京时间排期和错误报告根因的修复。

本轮已完成：
- 强化非日本动画排除规则：补充 `Primal / 史前战纪`、`熊熊帮帮团`、`Family Guy / 恶搞之家`、`Spidey and His Amazing Friends / 蜘蛛侠与他的神奇朋友们`、`SEALOOK`、`Pinkfong / Baby Shark` 等显式排除词；当前缓存未命中这些已知非日漫关键词。
- 新增 YourAnimes 低优先级时间源：更新顺序为 Bangumi、Bahamut、YourAnimes；YourAnimes 只作为日本播出时间和 Bangumi subjectId 参考，不再允许与旧缓存中 subjectId 不一致的同系列标题跨 cour 合并。
- 新增 `data/manual-broadcast-overrides.json`：当 Bangumi、Bahamut、YourAnimes 都无法补齐具体时间时，使用人工核验来源补全北京时间。所有覆盖项均写入 `Asia/Shanghai`，首播日期也按北京时间落库。
- 调整季度归属：`calculatePrimarySeason` 对 3/6/9/12 月 25 日及之后首播条目按下一季度归档；因此三月底播出的作品会视作 4 月番。
- 修复点击更新失败的根因：参考源条目与旧缓存标题相似但 Bangumi subjectId 不一致时禁止合并，避免 `CACHE_VALIDATION_FAILED` 的重复 ID 错误。
- 修复 YourAnimes 适配器配置语义：显式传入空 `timetableUrls` 或 `timetableFiles` 时表示禁用该类输入，不再回落到默认在线源。
- 处理 Turbopack 构建 warning：手动覆盖表读取路径改为受控 `data` 路径并使用 `turbopackIgnore`，避免构建追踪整个项目。

本轮数据状态：
- 已实际运行 2026 年四个季度更新：`season=1`、`season=4`、`season=7`、`season=10` 均返回 success。
- 当前 `data/anime.json` 共 166 条：1 月番 44 条，4 月番 42 条，7 月番 76 条，10 月番 4 条。
- 当前四个季度 `updateTime` 缺失数均为 0。
- 当前缓存无重复 ID，`npm run data:validate` 通过。
- 已知风险：当前环境访问 Bangumi API 仍返回 `fetch failed` warning，因此 4 月、7 月、10 月新增条目中存在较多 Bangumi 评分缺失；这属于外部主源连通性或请求策略问题，后续需要继续观察 Bangumi API 可用性、令牌、限流和网络环境。

本轮新增文件：
- `src/server/sources/youranimes/adapter.ts`
- `src/server/sources/youranimes/index.ts`
- `tests/fixtures/youranimes-sample.html`
- `data/manual-broadcast-overrides.json`
- `data/youranimes-202601.html`
- `data/youranimes-202604.html`
- `data/youranimes-202607.html`
- `data/youranimes-202610.html`
- `scripts/reconcile-current-cache.ts`

本轮修改文件：
- `.env.example`
- `package.json`
- `src/server/anime/calculateSeason.ts`
- `src/server/anime/updateAnimeData.ts`
- `src/server/sources/index.ts`
- `src/server/sources/bangumi/mapper.ts`
- `tests/unit/season.test.ts`
- `tests/unit/sources.test.ts`
- `tests/unit/update-flow-fixtures.test.ts`
- `data/anime.json`
- `data/status.json`
- `data/update-log.jsonl`
- `PROJECT_MANUAL.md`

最近验证：
- `npm run data:reconcile` 通过，完成缓存重整和手动覆盖应用。
- `npm run data:update -- --year 2026 --season 1 --force` 成功。
- `npm run data:update -- --year 2026 --season 4 --force` 成功。
- `npm run data:update -- --year 2026 --season 7 --force` 成功。
- `npm run data:update -- --year 2026 --season 10 --force` 成功。
- `npm run check` 通过：typecheck、lint、78 个单元测试、缓存校验、API smoke 全部通过。
- `npm run build` 通过且无 Turbopack warning。

## 18. 追加版本记录：2026-07-29 完结状态与 Bangumi 评分修复

本节为追加记录，不改写前文历史内容。当前版本状态维持 `0.1.1`，完成一轮针对“已完结作品仍显示连载/更新时间”和“Bangumi 有评分但前端显示评分人数不足”的实测反馈修复。

本轮已完成：
- 新增 `npm run data:sync-bangumi`，通过 `scripts/sync-bangumi-details.ts` 逐条读取当前缓存内 Bangumi subject 详情，补齐评分、评分人数、排名、总话数，并按北京时间排期推导终播日、已播话数和完结状态。
- 修复参考源合并时覆盖旧缓存的问题：YourAnimes/Bahamut 等参考源缺少 `episodeCount`、`airedEpisodeCount`、`endDate` 时，不再冲掉旧缓存中已经由 Bangumi 同步得到的字段。
- 修复完结状态推断：只有 Bangumi 给到总话数时，才根据首播日、每周更新时间和总话数生成完整周排期并推导终播日；无总话数且只有一集参考排期的条目不再被误判为完结。
- 修正评分空值文案：有 Bangumi subjectId 但评分为 `null` 时，前端显示“暂无公开评分”，不再统一显示“评分人数不足”。
- 已复跑 2026 年 4 月季度更新，确认在 Bangumi 主列表仍出现 `fetch failed` warning 的情况下，旧缓存中已同步的评分、总话数、终播日和完结状态不会被 YourAnimes 参考数据覆盖。

本轮数据状态：
- 当前 `data/anime.json` 共 166 条。
- 2026 年 4 月番共 42 条：31 条 `finished`，11 条 `airing`，0 条缺更新时间，2 条 Bangumi 详情仍无公开评分。
- 本轮 Bangumi 详情同步读取 166 个 subject，成功 166 个；补齐评分 73 条，补齐总话数 161 条，重算状态 79 条。
- 仍标记为连载的 2026 年 4 月番主要是 Bangumi 详情显示为 24 话或长期条目，终播日落在 2026 年 9 月或更晚；少数 Bangumi 未给总话数的长期条目保持 `airing`。

本轮新增文件：
- `scripts/sync-bangumi-details.ts`

本轮修改文件：
- `package.json`
- `src/server/anime/updateAnimeData.ts`
- `src/app/components/BangumiBadge.tsx`
- `data/anime.json`
- `data/status.json`
- `data/update-log.jsonl`
- `PROJECT_MANUAL.md`

最近验证：
- `npm run data:sync-bangumi` 通过。
- `npm run data:update -- --year 2026 --season 4 --force` 通过，未回退评分和完结状态。
- `npm run data:validate` 通过。
- `npm run test` 通过，78 个单元测试全部通过。
- `npm run build` 通过。
- `npm run check` 通过：typecheck、lint、单元测试、缓存校验、API smoke 全部通过。

## 19. 追加版本记录：2026-07-29 Bangumi 封面同步修复

本节为追加记录，不改写前文历史内容。当前版本状态维持 `0.1.1`。

本轮修复原因：
- 多数缺封面的条目并非前端渲染错误，而是缓存中 `coverImage=null`。
- 这些条目主要由 YourAnimes 先建立，再通过 `npm run data:sync-bangumi` 补 Bangumi 详情；此前该脚本只补评分、评分人数、总话数和状态，没有同步 Bangumi `images` 字段。

本轮已完成：
- `scripts/sync-bangumi-details.ts` 新增 Bangumi `images.large/common/medium/small/grid` 到 `coverImage` 的映射。
- 已重新运行 `npm run data:sync-bangumi`，当前 `data/anime.json` 166 条均已具备封面字段。

最近验证：
- 当前缓存封面缺失数为 0。
- `npm run data:validate` 通过。
- `npm run test` 通过，78 个单元测试全部通过。
