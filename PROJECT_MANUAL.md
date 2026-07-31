# Project Manual: 日本季度新番时间表

最后更新: 2026-07-31

本文件是后续 AI 的项目入口。先读本文件，再读相关代码。修改项目边界、季度规则、数据源、部署方式、缓存状态或数据口径时，必须同步更新本文件。

## 1. 当前状态

- 版本: `0.1.4`
- 技术栈: Next.js App Router, React, TypeScript, Node.js `>=24`
- 核心缓存: `data/anime.json`
- 当前缓存: 468 条, 只保留 TV、日本动画、非 excluded 条目
- 测试: 92 个单元测试; 最近 `npm run check` 通过
- 当前部署: GitHub Pages 静态公开页已成功; Vercel 仍可作为只读动态部署备选
- 最近数据自检: 2026-07-30 删除 14 条误入缓存的非日漫 TV 条目, 包含 `anime:547751` 幸福公寓、`anime:538958` 冰球旋风 第2季

## 2. 产品边界

只展示日本 TV 动画。

必须排除:

- 中国动画、中日合作动画、海外动画
- WEB、OVA、MOVIE、SP 等非 TV 条目
- R18、NSFW、成人内容
- `isJapaneseAnime=false` 或 `inclusionStatus="excluded"` 条目

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
src/server/sources/bangumi/   Bangumi 客户端、映射、匹配
src/server/sources/bahamut/   巴哈姆特参考源
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
- 已完结或取消条目不再继承 `updateTime` / `updateWeekday`
- `episodeCount` 与 `airedEpisodeCount` 不得矛盾
- 巴哈姆特、YourAnimes、人工覆盖写入的展示时间按北京时间 `Asia/Shanghai` 处理
- Bangumi 标题映射会修复 UTF-8 被误读为 Latin-1 的 mojibake, 不要移除
- Bangumi 非日漫过滤包含明确排除 subjectId, 不要把已确认的国产/海外动画重新放回可展示缓存

## 6. API 与静态模式

动态 API:

- `GET /api/anime?year=YYYY&season=1|4|7|10`
- `GET /api/status`
- `POST /api/update` body: `{ year, season, force? }`

API 永远过滤非日本动画、excluded、非 TV 和成人内容。

Vercel 默认只读: `process.env.VERCEL === "1"` 且 `ENABLE_VERCEL_UPDATE !== "true"` 时 `/api/update` 返回 403。设置 `UPDATE_API_TOKEN` 后, 更新请求必须带 Bearer Token 或 `x-update-token`。

GitHub Pages 静态模式:

- 前端通过 `NEXT_PUBLIC_STATIC_EXPORT=true` 读取 `/static-data/anime.json` 和 `/static-data/status.json`
- 静态页面不调用 `/api/*`
- 更新按钮在静态模式下禁用

## 7. 数据源与更新

数据源:

- Bangumi: 主源, 提供标题、subjectId、评分、封面、日期、集数、官网、制作信息
- 巴哈姆特: 参考源, 补充 UTC+8 / 北京时间更新时刻
- YourAnimes: 低优先级参考源, 补充日本首播时间和 Bangumi subjectId
- `data/manual-broadcast-overrides.json`: 最终人工覆盖, 只对未完结、未取消条目生效

常用数据命令:

```powershell
npm run data:update -- --year 2026 --season 7
npm run data:reconcile
npm run data:sync-bangumi
npm run data:validate
```

更新流程要点:

1. 校验 `year` 和 `season`
2. 检查更新锁
3. 读取 Bangumi、巴哈姆特、YourAnimes
4. 归一化、去重、按 `primarySeason` 过滤目标季度
5. 过滤 TV、日本动画、非成人内容
6. 与旧缓存合并, 保留可靠旧信息
7. 应用人工广播覆盖
8. 校验并写入 `data/anime.json`, `data/status.json`, `data/update-log.jsonl`

失败策略:

- 写入前校验失败: 不覆盖旧缓存
- 外部源失败: 记录 warning, 尽量保留可用旧缓存
- 目标季度无旧缓存且外部源无可用条目但有 warning: 返回 `SOURCE_UNAVAILABLE`, 不写入空成功

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

实现位置:

- `src/app/lib/userAnimePrefs.ts`: 读写 `localStorage`
- `src/app/components/UserAnimeActionButton.tsx`: 追番 / 观毕按钮
- `src/app/components/ScheduleControls.tsx`: 视图切换入口
- `src/app/components/FollowSchedule.tsx`: 追番时间轴与个人追番复用视图
- `src/app/components/ScheduleBoard.tsx` / `src/app/components/AnimeTable.tsx`: 统计列表与观看记录复用视图

本地存储:

- key: `anime-quarter-schedule:user-prefs:v1`
- schema: `{ followedIds: string[], completedIds: string[] }`
- 只保存 `AnimeItem.id`, 不保存完整番剧对象、标题、时间、封面或公共数据副本
- GitHub Pages 更新公共 JSON 后, 用户本地 `localStorage` 不会被覆盖
- 若用户清理浏览器数据、换浏览器、换域名或换设备, 本地个人状态不会自动迁移

视图:

- `stats`: 统计列表, 展示当前筛选后的季度条目
- `following`: 追番列表, 按周几展示当前筛选后的连载/延期条目
- `personalFollowing`: 个人追番, 与追番列表形式一致, 在追番列表的周几、连载状态判断上额外要求 `followedIds` 包含条目 `id`
- `watchHistory`: 观看记录, 与统计列表形式一致, 只展示 `completedIds` 包含条目 `id` 的作品

操作规则:

- `status === "airing"` 的条目显示“追番”, 点击后变为“已追番”, 再点取消
- `status === "finished"` 的条目显示“观毕”, 点击后变为“已观毕”, 再点取消
- 其他状态暂不显示个人状态操作
- 个人状态只与当前加载到前端的季度数据按 `id` 匹配; 不要用本地个人状态反向修改公共缓存

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
