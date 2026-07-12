# MiniRouter 开发计划（Roadmap / Future Work）

记录尚未实现、但需要提前定稿设计要点的功能，避免后续重复讨论。

## 1. 跨 Slot 升降智故障转移（Cross-slot escalation/de-escalation failover）

### 背景
- 当前 `executeWithChannelFallback`（`src/server/routes/channel-execution.ts`）仅在**同一 slot 内**做渠道故障转移（轮询 + 失败切换）。
- 路由层（`src/router/selector.ts`、`strategy.ts`）已按 14 维规则把请求定位到单个 slot（`fast`/`balanced`/`strong`/`vision`），即「升/降智」的**决策**已经存在，但执行期锁定单一 slot。
- 诉求：当所选 slot 的所有渠道都失败（或全部返回非 2xx）时，能按规则**跨 slot 兜底**——如 `strong` 不通则降级到 `balanced`/`fast`；或按策略向上试更高智模型。

### 设计要点
1. 入参从 `slot: ModelSlotName` 改为**有序候选 slot 链** `slots: ModelSlotName[]`（主 slot 在前，降级/升级 slot 在后）。
2. 向后兼容：单 slot 调用传 `slots=[slot]` 时行为完全不变。
3. 遍历逻辑：当前 slot 渠道池耗尽（`excludeIds` 覆盖该 slot 全部渠道）后，取下一个 slot 的 `listProviderInstances`，继续按 cursor 轮询 + 失败切换。
4. Executor 零改造：`ChannelExecutor = (slot: ModelSlot) => Promise<{upstream, optimization}>`，其唯一依赖就是 `ModelSlot`，跨 slot 只是换一个 slot 对象喂给它。
5. cursor / `excludeIds` 继续按 `slot` 做 key，各 slot 独立轮询、独立排除已试渠道。
6. Slot 链生成策略（待定，需配置点）：
   - 降级链：`strong → balanced → fast`（高智失败降级低智）
   - 升级链（可选）：`fast → balanced`，视成本/质量策略
   - 建议由 slot 配置声明各自的 fallback 顺序，而非硬编码。
7. 计数/日志：每次跨 slot 切换应在 `routingDebug` 中记录「原 slot → 最终 slot → 是否跨 slot」，便于回执体现「已降级/升级」。
8. 健康记录沿用 `recordProviderFailure` / `recordProviderSuccess`，仍按渠道维度，不变。

### 影响范围
- 仅改 `src/server/routes/channel-execution.ts`。
- `chat.ts` / `anthropic-messages.ts` 只需把 `slot: configured.slot.slot` 换成 `slots: <生成的链>`（默认 `[configured.slot.slot]`）。
- executor、健康记录、cursor 管理均无需改动。

### 验收
- 单测：slot 链内第 1 slot 全失败 → 自动用第 2 slot 成功。
- 全链失败 → 透传最后错误 / 抛错（同现有行为）。
- OpenAI 与 Anthropic 两路由共享同一 slot 链逻辑。

## 2. 演进到「学习型路由模型」（learned routing model）

> 方向性目标，不是引入某个具体项目依赖。参考概念来自 MiniRouter / TinyRouter 这类「tiny LLM router」研究（Gittensor 路由竞赛、TRINITY 方法，Xu et al., ICLR 2026, arXiv:2512.04695）：**不训练一个巨型模型，而是训练一个极小的路由器**——对每道题决定「该问哪个模型 + 让它扮演什么角色」。

### 当前 vs 目标
- 当前：`src/router/` 是 14 维**规则/打分**路由（确定性、可解释、易调试）。
- 目标：在规则层之上（或替代部分规则）引入**数据驱动的可学习路由头**，用真实用量/成败回执做训练信号，逐步逼近「按任务选最优模型」。

### 关键设计要点（从参考概念提炼，非照搬）
1. **极小路由体**：冻结的轻量编码器把请求压成单向量，加一个极小的 head（参考规模 ~10K 参数）输出路由决策（选 slot / 选模型 / 选 role）。延迟与成本应远低于调用大模型本身。
2. **决策目标**：不仅选「哪个 slot」，还要能选「什么角色/提示策略」——与本项目已有的 Headroom 上下文优化（`src/context/`）可结合。
3. **训练信号（reward）**：用真实回执构造二值/ shaped reward（回答是否正确、是否被验证器接受、成本是否超预算、延迟是否达标）。可复用现有 `logUsage` 的 `status`/`errorType`/`costUsd`/`latencyMs` 字段。
4. **免梯度进化训练**：参考 sep-CMA-ES（可分进化策略）这类 derivative-free 方法，对 head 做「繁殖候选 → 保留最优」的进化；不依赖反向传播，工程上更轻、风险更低。
5. **多轮循环**：支持 up-to-5-turn 的「路由→回答→验证→再路由」，验证通过即提前终止。与现有 SSE 用量采集、`routingDebug` 回执天然契合。
6. **oracle-ceiling 诊断**：训练前先估计「完美路由」能达到的上限，判断当前模型池是否还有路由增益空间，避免在无 headroom 的任务上空耗。这是决定「要不要上学习型路由」的关键前置。
7. **可解释兜底**：学习型 head 与现有 14 维规则并存，head 置信度低或诊断显示无 headroom 时回退到规则路由（保证可控、可调试）。

### 落地前的待办 / 前置
- 先完成第 1 项（跨 slot 故障转移），让执行层具备「多候选自动切换」能力，学习型路由才有可靠的兜底基座。
- 沉淀足够多的带标签回执数据（成功/失败/成本/延迟），作为 reward 与诊断的数据源。
- 明确模型池差异度：参考结论「路由收益来自模型间真实差异」，先量化本池各 slot 的能力差异，定位高 headroom 的任务类型。
- 定义本地 head 的输入特征（复用 14 维特征 + 请求向量）与输出空间（slot 链 / role / 多轮策略）。

## 3. Agentic 分支路由（Agentic tier routing branch）

### 背景
- 当前路由引擎（`src/router/strategy.ts`）已经支持 agentic 检测：`agenticScore`（0-1）在 `classifyByRules()` 中计算，`scoreAgenticTask()` 扫描 Agentic 关键词（文件操作、执行、多步骤、迭代工作）。
- `RoutingConfig` 类型已定义 `agenticTiers?: Record<Tier, TierConfig> | null`，`strategy.ts` 已具备根据 `agenticScore >= threshold` 自动切换到 `agenticTiers` 的逻辑。
- 但 `agenticTiers` 配置在 `src/router/config.ts` 中**被注释掉了**，导致实际未生效。
- 诉求：当请求检测到 agentic 特征时，路由到**专为多步骤自主任务优化**的模型池，而非普通聊天模型池。

### 设计要点
1. **agenticTiers 配置复活**：取消 `config.ts` 中 `agenticTiers` 的注释，填入适合 agentic 场景的模型（工具调用好、自主执行强、上下文窗口大）。
2. **Slot 映射**：`agenticTiers` 选出的模型需要映射到对应的 slot（`fast`/`balanced`/`strong`/`vision`），通过 `pickSlotForFeatures()` 或新增 `pickSlotForAgentic()` 实现。
3. **Profile 独立**：`agentic` profile 应独立于 `auto`/`eco`/`premium`，但可以与它们叠加——如 `eco + agentic` → 便宜且工具调用好；`premium + agentic` → 最强自主模型。
4. **回执体现**：`routingDebug` 中标记 `profile: "agentic"`，让用户可见「当前请求走了 agentic 分支」。
5. **阈值可调**：`MINIROUTER_AGENTIC_SCORE_THRESHOLD` 环境变量已存在，默认 0.5。

### 需进一步思考的复杂场景
> Agentic 路由的难点在于准确识别「真正需要 agentic 模型」的请求，避免误判。以下场景需要仔细设计：
> - 请求带 `tools` 数组但只是简单问答（如天气查询）→ 不应走 agentic 分支
> - 请求无 tools 但隐含多轮链（如"先分析代码，再改文件，最后运行测试"）→ 应走 agentic 分支
> - 工具调用 + 结构化输出混合 → 需区分工具用途（查询 vs 执行）
> - 多轮会话中只有部分轮次需要 agentic → 需逐轮判定
> - 同一 agentic 框架（如 Claude Code、OpenCode）的不同指令差异很大

### 影响范围
- `src/router/config.ts`：取消 `agenticTiers` 注释，配置合适的模型。
- `src/providers/env.ts`：`pickSlotForFeatures()` 可能需要支持 agentic 模式的 slot 选择。
- `src/router/strategy.ts`：逻辑已就绪，无需改。
- `admin/dashboard.html`：用量日志中显示 `profile: "agentic"`。

### 验收
- 请求含 agentic 关键词（如"编辑文件然后执行"）→ `agenticScore >= 0.5` → 走 `agenticTiers` → 日志显示 `profile=agentic`。
- 普通请求 → `agenticScore < 0.5` → 走普通 `tiers` → 日志显示 `profile=auto`。
- `MINIROUTER_AGENTIC_MODE=false` 可强制关闭 agentic 分支（已实现）。

## 4. Headroom 上下文压缩上线

### 背景
`src/context/headroom.ts` 已实现完整的 `optimizeWithHeadroom()` 函数，支持 adaptive（尾块压缩）和 force（全量压缩）两种模式，已集成到 `chat.ts` 和 `anthropic-messages.ts`。但当前处于**默认关闭**状态，且缺少必要的运维配套。

### 现状（半成品清单）

| 问题 | 状态 |
|------|------|
| `MINIROUTER_HEADROOM_ENABLED` 默认 false | 用户需手动开启 |
| Headroom proxy 需要独立 Python 环境启动 | 无 docker-compose 集成，需手动 `start-headroom.bat` |
| 文档中提到的本地 fallback `compressRequestTail()` 从未实现 | 代码中不存在此函数，proxy 不可用时静默跳过 |
| `MINIROUTER_TAIL_COMPRESSION_ENABLED` 环境变量未在 `.env.example` 中暴露 | 处于半隐形状态 |
| 无启动时 Headroom proxy 可用性探活 | 请求来时才发现连接失败 |
| local tail compression 的 metrics 未记录到 `usageLogs` | 压缩是否生效只能看日志 |

### 设计要点
1. **Headroom proxy 容器化**：在 `docker-compose.yml` 中增加可选 headroom 服务，或提供 `docker-compose.headroom.yml` 分离配置，不强制部署。
2. **启动探活**：MiniRouter 启动时主动探测 `MINIROUTER_HEADROOM_URL` 是否可达，unreachable 时降级为本地压缩并记录健康状态。
3. **本地 tail 压缩替代**：实现 `compressRequestTail()` 函数，在 Headroom proxy 不可用时做 in-process 的 head+tail+important-lines 提取（文档中已有承诺但代码缺失）。
4. **默认开启 adaptive**：将 `MINIROUTER_HEADROOM_ENABLED` 默认值改为 `true`，让用户开箱即用。
5. **暴露全部配置项**：`MINIROUTER_TAIL_COMPRESSION_*` 系列变量写入 `.env.example` 和 `docs/headroom.md`。
6. **压缩 metrics 上报**：无论 proxy 还是本地压缩，结果都写入 `usageLogs.compressionApplied` 等字段，便于 dashboard 可视化。

## 5. 管理后台（Admin Dashboard）完善

### 现状
`admin/dashboard.html` 是一个 686 行的纯手写单页 HTML，无前端框架，无构建工具，所有 API 调用硬编码路径。功能有限：
- 用户列表 + 创建/禁用
- 渠道列表 + 创建/删除
- 用量日志查询
- 无身份认证保护（仅靠 Hono 路由层鉴权）

### 待办
1. 迁移到轻量前端框架（如 React + Vite 或 Svelte），便于维护和扩展。
2. 增加仪表盘首页：日/周/月用量趋势图、成本分布、路由命中热力图。
3. 增加 Headroom 压缩效果可视化：压缩率、节省 token 数、各模型压缩效果对比。
4. 增加路由调试可视化：请求特征 → 路由决策 → 最终 slot 的链路追踪。
5. 增加模型评分卡编辑界面（当前只能通过 API 或 seed 脚本更新）。
6. 多用户切换：支持查看不同用户的用量和配置。
7. 构建时打包到 `dist/`，开发时支持 HMR。

## 6. Teams / 多租户管理（Phase 3）

### 现状
`src/db/schema.ts` 已定义 `teams` 和 `teamMembers` 表，migration 已建表，但：
- 没有任何 CRUD 查询函数（`src/db/queries/` 下没有 teams 相关文件）
- 没有任何 API 路由暴露 teams 管理
- `routingConfigs.teamId` 字段虽然存在，但从未被任何代码读取或写入
- 注释标注为 Phase 3，属于搁置状态

### 待办
1. 实现 `src/db/queries/teams.ts`：createTeam、getTeam、listTeams、addMember、removeMember 等。
2. 实现 `src/server/routes/teams.ts`：REST API 路由。
3. 实现配置继承链：`user → team → global default`，`routingConfigs` 按 `priority` 字段合并。
4. 用量聚合：支持按团队维度汇总 spend + token 用量。
5. 管理后台增加团队管理页面（依赖第 4 项后台完善）。

## 7. 数据库路由配置（DB-backed RoutingConfigs）

### 现状
`routingConfigs` 表已存在（有 `userId`、`teamId`、`priority`、`configJson` 字段），但：
- `src/router/config.ts` 的 `getConfig()` 只读环境变量，完全不碰数据库
- 没有任何代码向 `routingConfigs` 表写入数据
- 路由层完全依赖 `DEFAULT_ROUTING_CONFIG` + 少数 `MINIROUTER_*` 环境变量覆盖

### 待办
1. 实现 `getConfigForUser(userId)`：先查 user 级配置，再查 team 级配置，最后 fallback 到环境变量/DEFAULT。
2. 实现 `updateUserRoutingConfig(userId, partialConfig)`：允许管理员通过 API 为用户定制路由参数。
3. 实现配置合并逻辑：user 配置只覆盖部分字段，其余从 DEFAULT 继承（与现有环境变量覆盖兼容）。
4. API 路由：`GET/PUT /api/admin/users/:id/routing-config`。
5. 管理后台支持路由配置编辑（依赖第 4 项）。

## 8. SSE 用量采集健壮性

### 现状
`src/server/sse-usage-tap.ts` 的 `createSseUsageTap` 已实现并集成到 `chat.ts` 和 `anthropic-messages.ts`，但：
- Promise 错误处理存在空 catch：`// 流被客户端中断,不写 log`，丢失了异常可见性
- 没有超时机制：如果上游流一直不结束，`finalUsage` 永远不 resolve
- 没有重试机制：`logUsage` 写入失败时静默 catch

### 待办
1. 为 `finalUsage` 增加超时兜底（如 30s 后强制 resolve 当前累计值）。
2. 增加 `logUsage` 写库失败的重试（至少 1 次）。
3. 增加结构化日志记录 SSE 解析异常，方便排查用量统计不准的问题。
4. 考虑 `usageLogs` 的批量写入（当前逐条 insert，高并发下可能成为瓶颈）。

## 9. 模型评分数据维护机制

### 现状
- `models/seed-data.json` 中存储了评分数据，`models/seed-models.ts` 脚本负责导入到数据库。
- `archive/registry.ts` 是旧代码，已被归档移除。
- 没有 API 让用户持续更新模型评分（只能通过 seed 脚本全量替换）。
- 没有机制自动拉取模型价格更新（如 OpenRouter 价格变动）。

### 待办
1. 实现 `models/sync.ts`：定时从上游（如 OpenRouter API）拉取模型列表和价格，增量更新到 `modelScores` 表。
2. 实现 `PATCH /api/admin/models/:id` 允许管理员手动调整评分。
3. 实现评分版本管理：每次 seed 或更新保存快照，支持回滚。
4. 管理后台增加模型评分编辑界面（依赖第 4 项）。

## 10. 路由配置代码拆分（`src/router/config.ts` 瘦身）

### 现状
`src/router/config.ts` 长达 1401 行，全部是 `DEFAULT_ROUTING_CONFIG` 常量的定义（14 维权重、多语言关键词、分类器配置、兜底模型列表等）。`getConfig()` 函数只有 ~50 行。

### 待办
1. 将 `DEFAULT_ROUTING_CONFIG` 拆分为单独文件（如 `src/router/config-default.ts`）。
2. 将多语言关键词列表提取到 `src/router/config-keywords.ts`。
3. 将兜底模型列表提取到 `src/router/config-fallback-models.ts`。
4. 保持 `config.ts` 只负责 `getConfig()` 和 `MINIROUTER_*` 环境变量覆盖逻辑。

---

> 注：本仓库当前为本地开发版（含服务器连接信息在 `.env`，不入库）。开源前需先确认敏感信息剥离（见 `docs/db-queries.md` 占位约定）。