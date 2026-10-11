# 词间流畅度优化记录

日期：2026-10-11。交付范围为本地源码与验证材料，不发布网站。

继续保留私人四六级学习站的阅读、查词、个人联想及三方向复习流程。本轮处理重复请求和重复派生计算；学习内容、成绩判定、复习间隔、账号记录格式及页面布局保持原有含义。

## 实际改动

- **阅读保存后直接接收状态。** 段落完成接口返回保存后的 state、revision 和 ETag，阅读页将该快照交给学习空间，避免保存成功后再获取同一份状态。继续下一段仍保留其必要请求。
- **保存与条件同步使用一致的 ETag。** 普通状态保存和阅读保存复用按账号、修订号生成的校验值。客户端保存成功后更新状态及校验值，后续无变化的同步能够返回空的 304 响应。
- **会话、修订号与校验值一起接受。** `snapshot-sync` 将 epoch、revision、ETag 放在同一个接受规则中；迟到的旧会话或旧修订号响应不覆盖新状态和校验值。304 也核对发出请求时的校验值，账号切换清除旧值；认证仍由接口执行。
- **北京时间窗口替代逐条日期转换。** Today 的今日阅读、练习次数和 Library 的每日额度，共用 `beijingDayBounds`，按当天起点包含、次日起点不包含来计数。保留原有 memo、北京时间日界线和全部词表计数范围。
- **缓存现有派生结果。** Library 缓存每日额度；RecentPractice 缓存词表、词索引和最近记录；Statistics 缓存筛选、各方向统计、常错词和近期记录。词索引用 Map 查询，近期 20 条先截取再反转；统计含义与显示范围没有扩大。

主要实现位于 `app/study-app.tsx`、`app/lesson.tsx`、`app/api/state/route.ts`、`app/api/passages/route.ts`、`lib/state-etag.ts`、`lib/snapshot-sync.ts`、`app/learning-day.ts`、`app/today.tsx`、`app/library.tsx` 与 `app/statistics.tsx`。

## 验证方法与适用范围

### 浏览器前后对照

baseline 使用 cb6caee 的生产构建，after 使用本轮代码重新构建的产物；保持相同浏览器、模拟数据和测试流程。数据由内置 2,163 词及合成状态生成，经 stateSchema 校验，不读取真实账号或用户数据库。

| 条件 | 设置 |
| --- | --- |
| 事件数量 | 0、1,000、10,000 条合成记录 |
| 视口宽度 | 1,440px、390px，每种记录量分别测量 |
| 浏览器 | Windows Headless Chrome 154，CPU 设为 4 倍节流 |
| 接口 | 浏览器 mock API，固定 120ms 延迟，状态变化在测试内存中处理 |
| 动态效果 | reduce motion |
| 冷加载 | 每个 case 各单次，作为样本记录，不估计稳定分布 |
| 主要交互 | 每个 case 至少 5 个样本，报告中位数和最慢样本 |

主要操作覆盖词库搜索、返回今日学习、保存个人联想、提交答案和继续下一段。记录下一帧 DOM 出现可观察反馈的时间，以及目标界面达到 ready 条件的时间；同时收集请求和长任务信息。

这些时间是该测试流程的 DOM 反馈／ready 指标，不是真实 INP。390px 加 CPU 节流仍是桌面 Chrome 模拟环境，不代表真手机、移动网络或线上 D1 的表现。“首开”指新浏览器会话首次进入视图，未独立测量 CDN 缓存或弱网资源下载。mock API 用于比较客户端和请求流程，真实接口语义由独立验证脚本检查。

原始 JSON、生成的合成 fixture 和测试运行材料位于 Git 忽略目录 `.sites-runtime/flow/`。以下保留首轮完整 baseline／after 数字。

### 完整浏览器结果

单位为毫秒，单元格是「中位数（最慢值）：优化前 → 优化后」。每格至少 5 次，冷加载不混入 warm 样本。

| 视口／合成事件 | 搜索 | 返回今日页 | 阅读下一段 | 联想保存 | 答案保存 |
| --- | --- | --- | --- | --- | --- |
| 1440px／0 | 18.5 (37.2) → 7.6 (13.4) | 43.9 (74.7) → 40.6 (43.2) | 480.9 (537.1) → 317.7 (350.4) | 231.2 (291.4) → 197.4 (205.6) | 185.5 (226.3) → 179.8 (187.0) |
| 1440px／1,000 | 18.0 (29.9) → 7.8 (13.2) | 57.1 (63.7) → 49.8 (54.7) | 498.4 (501.2) → 332.5 (359.6) | 224.1 (257.8) → 198.9 (212.8) | 196.1 (199.9) → 194.8 (228.8) |
| 1440px／10,000 | 19.7 (26.2) → 7.9 (13.1) | 64.9 (71.8) → 51.0 (58.0) | 599.4 (612.0) → 384.3 (466.9) | 248.9 (251.3) → 268.2 (278.5) | 214.9 (223.9) → 249.2 (384.3) |
| 390px／0 | 18.6 (41.9) → 7.0 (16.7) | 44.1 (86.5) → 45.7 (59.4) | 522.6 (528.1) → 321.2 (343.9) | 232.6 (244.3) → 190.6 (201.9) | 180.7 (190.9) → 176.3 (189.2) |
| 390px／1,000 | 18.6 (55.3) → 9.4 (16.6) | 66.9 (99.7) → 51.1 (65.1) | 502.3 (525.2) → 328.0 (341.8) | 224.0 (238.2) → 195.2 (219.3) | 178.3 (185.1) → 182.7 (193.5) |
| 390px／10,000 | 16.3 (25.2) → 9.0 (17.4) | 67.4 (73.0) → 49.9 (53.6) | 565.4 (613.8) → 373.6 (421.6) | 255.6 (270.1) → 238.6 (245.5) | 215.8 (231.5) → 230.0 (254.0) |

阅读下一段的每次实测请求从 complete POST → state GET → next POST，改为 complete POST → next POST。六组样本均为 3 次 → 2 次；后续聚焦同步继续保留。两个真实写入接口的内存验证确认：携带保存后 ETag 的下一次无变化 GET 返回 304，body 为空。1,000 条合成事件下，旧链路在两种保存后额外传输的完整状态合计 320,212 字节（未压缩），新协议可避免这部分重复传输。

搜索与阅读等待改善较一致；普通答案保存没有稳定改善，桌面 10,000 条记录的首轮 after 比 baseline 更慢。额外复测保留为 after-check-1440-10000.json，用于观察波动，不替换上述首轮数字（联想保存复测 238.7ms，答案保存复测 233.5ms）。这类保存仍传输完整 state，并等待服务端确认再推进。

| 10,000 条／页面操作 | 1440px：前 → 后 | 390px：前 → 后 |
| --- | --- | --- |
| 学习记录（warm） | 47.5 (56.2) → 54.2 (63.4) | 49.2 (71.9) → 49.1 (51.2) |
| 词库（warm） | 42.6 (47.1) → 47.9 (53.6) | 42.3 (70.9) → 42.0 (42.4) |
| 单词详情 | 49.3 (91.4) → 45.1 (88.7) | 68.2 (108.7) → 38.8 (92.3) |
| 学习记录（首开单次） | 363.4 (363.4) → 365.6 (365.6) | 385.6 (385.6) → 370.9 (370.9) |
| 阅读（首开单次） | 542.9 (542.9) → 530.5 (530.5) | 513.1 (513.1) → 523.4 (523.4) |

每组 45 个操作中捕获到的至少 50ms 长任务（前 → 后）：1440px/0: 8 → 1；1440px/1000: 12 → 7；1440px/10000: 16 → 12；390px/0: 10 → 3；390px/1000: 16 → 11；390px/10000: 22 → 8。这是本地采样，不能由此推算线上长任务率。优化后成套对照样本的最慢 DOM 反馈为 106.4ms。

滚动单独记录了 240 张词卡、60 次 requestAnimationFrame 内的 scrollBy 和帧间隔；没有改动滚动 CSS，也不据此宣称真实设备帧率提升。冷加载仍有整词库解析与模块下载成本，本轮未拆分词库包。登录入口静态 JS 预算检查为 490,605 字节，四个次级视图仍按需加载。

浏览器回归通过四项：result 首响应失败后保留答案、同 operationId 重试只记一次；complete 失败不进入下一段；较新 GET 先返回后旧 complete 仍继续且不回退 ETag；退出后旧 complete 不回填状态、不请求下一段。所有 API 都在浏览器内封闭模拟。


### 规则与同步验证

生产构建、TypeScript、所有改动文件的 ESLint 与 diff 检查通过。以下规则、接口及浏览器脚本也均通过；另已验证大小写／中文搜索、四级 89 条筛选、全部 2,163 条、熟悉程度筛选、主题轮换与 390px 无水平溢出。

- `verify-learning.mjs`、`verify-reading.mjs`：现有学习排程、三方向和阅读覆盖／重读规则。
- `verify-learning-day.mjs`：调用实际日期窗口 helper，与原 chinaDay 逐条转换对照；覆盖北京时间午夜前后 1ms、跨年、闰日，以及 0／1,000／10,000 条合成时间戳的计数和额度。
- `verify-snapshot-sync.mjs`：快照接受规则，包含旧 epoch、旧修订号和 304 校验值一致性。
- `verify-save-snapshots.mjs`：真实保存处理函数与隔离存储的快照／ETag 协议检查。
- `verify-passages-api.mjs`：真实段落处理函数、隔离 SQLite，覆盖分页、级别隔离、保存幂等和阅读进度。
- `verify-client-budget.mjs`：现有登录入口资源预算检查，资源体积不直接换算成加载时间。
- `verify-client-flow.mjs`：上述四项保存失败／重试、阅读乱序与退出会话的真实 UI 回归；API 完全模拟。

纯内存派生基准保存在 `.sites-runtime/derive-benchmark/`，用于定位计算成本。候选统计算法没有全部用于产品；其数字不作为实际页面提升或浏览器验收结果。

## 重跑命令

先停止占用 dist 的本地预览服务（Windows 构建会清理产物）。从项目根目录执行生产构建，然后启动独立本地 Wrangler。`8792` 用于浏览器模拟 API 对照，持久化目录也与日常本地运行分开。

```powershell
npm.cmd run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .sites-runtime/flow/wrangler --ip 127.0.0.1 --port 8792 --inspector-port 0
```

服务运行期间，在第二个终端进入同一项目目录执行：

```powershell
node scripts/measure-flow.mjs after
node scripts/verify-client-flow.mjs
```

该脚本按记录量与视口生成 fixture，复用测量模板，通过 Playwright CLI 驱动 Chrome 并拦截 mock API。需可用的 Chrome、Playwright CLI 和项目依赖。比较 baseline 时使用保留的原生产构建及相同参数；当前优化后的构建用于 after。

代码与协议检查：

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js app/study-app.tsx app/lesson.tsx app/today.tsx app/library.tsx app/statistics.tsx app/learning-day.ts app/api/state/route.ts app/api/passages/route.ts lib/snapshot-sync.ts lib/state-etag.ts scripts/verify-learning-day.mjs scripts/verify-snapshot-sync.mjs scripts/verify-save-snapshots.mjs
node scripts/verify-learning.mjs
node scripts/verify-reading.mjs
node scripts/verify-learning-day.mjs
node scripts/verify-snapshot-sync.mjs
node scripts/verify-save-snapshots.mjs
node scripts/verify-passages-api.mjs
node scripts/verify-client-budget.mjs
```

本轮未运行下面三项现有脚本。它们连接 `127.0.0.1:8791`，需另行启动对应的隔离 QA 服务与测试配置，不使用上述 8792 mock API。

```powershell
node scripts/verify-auth.mjs
node scripts/verify-api.mjs
node scripts/verify-sync.mjs
```

## 回归边界

检查搜索结果、中文与大小写搜索、四六级切换、最近记录顺序、日期切换及额度更新；确认个人联想、答案和阅读保存后的反馈与状态一致。失败重试、幂等保存、账号切换、乱序响应、恢复冲突和 304 认证约束继续保持。

不把合成样本数量视为真实账号规模，不把单次冷加载或 CPU 基准推算为线上收益；浏览器结果与协议验证分别记录。全部测量使用本地隔离环境或内存 mock 状态，没有向真实账号或用户数据库写入测试记录。
