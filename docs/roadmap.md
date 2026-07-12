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


> 注：本仓库当前为本地开发版（含服务器连接信息在 `.env`，不入库）。开源前需先确认敏感信息剥离（见 `docs/db-queries.md` 占位约定）。

## 3. （待补充）
