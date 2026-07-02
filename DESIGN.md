# MiniRouter — 产品框架与路由策略设计

## 一句话定位

**面向国内 LLM 的智能路由网关。用户买套餐（Pro/ProMax），系统自动识别任务难度，简单任务用便宜模型、复杂任务用强模型，赚取模型差价。**

---

## 竞品研究

### OpenRouter 是怎么做的

OpenRouter 是全球最大的 LLM 路由平台（400+ 模型，70+ 提供商），核心能力：

**1. Auto Router（`openrouter/auto`）**
- 底层由 NotDiamond 提供路由引擎
- 用户设置 `model: "openrouter/auto"`，系统自动选择最优模型
- 核心参数 `cost_quality_tradeoff`（0-10）：
  - 0 = 纯质量优先
  - 10 = 极致省钱
  - 7 = 默认，平衡
- 模型池精选 5-8 个顶级模型，动态更新

**2. 请求处理流程**
```
用户请求 → 分析 prompt 复杂度/任务类型
        → 过滤（上下文窗口、多模态、工具调用等硬约束）
        → 按 cost_quality_tradeoff 排序
        → 选最佳模型 → 转发 → 返回结果（附实际使用模型）
```

**3. Session 粘性**
- 同一会话自动固定模型，避免中途切换
- 通过 hash(messages) 或显式 `session_id` 实现

**4. 定价模式**
- 按量计费（credits 充值），没有订阅费
- 用户付模型实际价格，OpenRouter 赚取批发差价
- Auto Router 本身不额外收费

**5. 对我们有启发的**
- `cost_quality_tradeoff` 这个单一滑块是简洁优雅的 UI
- 模型池不是全量 400 个，而是精选池——这跟我们思路一致
- Session sticky 保证多轮对话不跳模型

### 2026 国内模型价格格局

从 OpenRouter 价格和国内 API 报价综合，关键数据点：

| 模型 | 输入 ¥/百万token | 输出 ¥/百万token | 定位 |
|------|:---:|:---:|------|
| DeepSeek V4-Flash | ~0.70 | ~1.70 | 极便宜，日常任务 |
| DeepSeek Chat V3 | ~1.10 | ~2.20 | 性价比之王 |
| DeepSeek R1 | ~3.50 | ~7.00 | 推理旗舰 |
| 通义千问 Turbo | ~0.25 | ~0.60 | 超便宜轻量 |
| 通义千问 Plus | ~3.10 | ~7.80 | 中档主力 |
| 通义千问 Max | ~6.00 | ~13.50 | 旗舰 |
| GLM-4-Flash | 免费 | 免费 | 免费轻量 |
| GLM-5 | ~7.80 | ~25.00 | 推理旗舰 |
| Kimi K2.x | ~1.50-15 | ~12-20 | 中档 |
| 豆包 Lite | ~0.35 | ~1.40 | 极便宜 |
| 豆包 Pro | ~3.30 | ~6.70 | 中档 |

**核心洞察**：
- 最便宜模型（Qwen-Turbo ¥0.25）和最贵模型（GLM-5 ¥25）输入价格差 **100 倍**
- 这就是套利空间：简单任务走 ¥0.25 的模型，复杂任务走 ¥6 的模型
- 但**中文场景的关键词表和英文完全不同**，ClawRouter 的规则引擎需要完全重做

---

## 路由策略设计（核心竞争力）

### 三层路由架构

```
Layer 1: 规则分类器（<1ms, 零成本）
  ├─ 14维中文关键词打分（需重做中文关键词表）
  ├─ 输出: SIMPLE / MEDIUM / COMPLEX / REASONING 四档
  └─ 处理 70-80% 请求

Layer 2: 成本阈值 Gate（<5ms, 无额外成本）
  ├─ 用户套餐 → 对应 cost_quality_tradeoff 值
  ├─ Pro 用户: tradeoff=7（便宜优先）
  ├─ ProMax 用户: tradeoff=3（质量优先）
  └─ 根据 tradeoff 在 tier 候选池中选具体模型

Layer 3: AI 分类器兜底（~50-200ms, 有成本）
  ├─ 规则分类 confidence < 阈值时触发
  ├─ 用极便宜的模型（如 Qwen-Turbo ¥0.25）做分类
  └─ 处理 20-30% 边缘请求
```

### 路由策略核心洞察（来自 ClawRouter vs RouteLLM 对比）

**好消息：ClawRouter 的关键词表已经是中英双语。** 代码里每个维度都有中文关键词（证明/定理/推导、函数/类/导入、算法/架构/微服务、构建/创建/实现、不超过/至少/预算、表格/结构化、量子/拓扑/同态……），不需要从零做中文版。只需要把模型池从海外模型换成国内模型。

**RouteLLM 不适合做主力。** RouteLLM 的核心是"训练一个分类器预测该请求是否需要强模型"，需要偏好数据（Chatbot Arena 数据集）。国内模型没有这个数据，冷启动不可行。但它的"成本阈值 gating"思想值得借鉴。

**最终方案：三层路由**

```
Layer 1: 规则分类器（<1ms, 零成本, 处理 70-80%）
  └─ 复用 ClawRouter 14维打分 → SIMPLE/MEDIUM/COMPLEX/REASONING
  └─ 已有中英文关键词，开箱即用

Layer 2: 成本阈值 Gate（<1ms, 核心创新）
  └─ 用户套餐 → costBudget（每请求成本上限）
  └─ Pro 用户: budget=¥0.004/次 → 如果选中的模型成本超标，自动降 tier
  └─ ProMax 用户: budget=¥0.02/次 → 可以上旗舰模型
  └─ 这就是 RouteLLM "threshold" 思想的逆用：不是"质量不足再升级"
     而是"成本超标就降级"——因为订阅制下，约束是用户的成本上限

Layer 3: AI 兜底（仅 20-30% 边缘请求触发）
  └─ 规则 confidence < 0.7 时，用 Qwen-Turbo（¥0.25）做分类
  └─ 收集用户反馈 → 未来可训练 Layer 3 偏好模型
```

### 档位 → 模型池映射（基于 2026.7 最新价格）

#### 模型池 MVP：Starter / Pro / ProMax 三档

| 模型 | 角色 | 输入¥/M | 输出¥/M | 速度 | 代码 | 推理 | 多模态 |
|------|------|---------|---------|------|------|------|--------|
| **MiMo-V2.5 (小米)** | Starter | 0.74 | 1.96 | ⚡0.21s | 70 | 65 | 全模态✅ |
| **DeepSeek V4-Flash** | Pro 主力 | 1.0 | 2.0 | 快 | 85 | 65 | ❌ |
| **GLM-5.2 (智谱)** | ProMax | 8.0 | 28.0 | 中 | 95 | 90 | 视觉✅ |

#### 三档路由方案

```
ProMax (¥299/月, costBudget=¥0.05/次):
  SIMPLE    → MiMo-V2.5 (¥0.74)    ← 简单任务不吃亏
  MEDIUM    → DeepSeek V4-Flash    (¥1.0)
  COMPLEX   → GLM-5.2              (¥8.0)
  REASONING → GLM-5.2              (¥8.0)

Pro (¥99/月, costBudget=¥0.01/次):
  SIMPLE    → MiMo-V2.5 (¥0.74)    ← 简单任务仍用便宜模型
  MEDIUM    → DeepSeek V4-Flash    (¥1.0)
  COMPLEX   → DeepSeek V4-Flash    (¥1.0)
  REASONING → DeepSeek V4-Flash    (¥1.0) — 不给旗舰，控制成本

Starter (¥39/月, costBudget=¥0.003/次):
  SIMPLE    → MiMo-V2.5 (¥0.74)
  MEDIUM    → MiMo-V2.5 (¥0.74)
  COMPLEX   → MiMo-V2.5 (¥0.74)
  REASONING → MiMo-V2.5 兜底       — 不给推理
```

> **利润来源**：用户真实请求 70% 是 SIMPLE+MEDIUM，走 ¥0.74-1.0 的便宜模型。20% COMPLEX 才上中等模型，只有 10% REASONING 才需要旗舰。ProMax 用户的 GLM-5.2 只在真正需要的时候调用。

---

## 模型评分数据库设计

路由引擎的决策依赖：先有模型评分卡 → 才能做智能调度。

```sql
CREATE TABLE model_scores (
  id            TEXT PRIMARY KEY,         -- "deepseek-v4-flash"
  provider      TEXT NOT NULL,             -- "deepseek" | "zhipu" | "xiaomi"
  display_name  TEXT NOT NULL,             -- "DeepSeek V4 Flash"
  tier          TEXT NOT NULL,             -- "starter" | "pro" | "promax"

  -- 价格 (元/百万token)
  price_input    REAL NOT NULL,
  price_output   REAL NOT NULL,
  price_cache    REAL,                     -- 缓存命中价格

  -- 能力评分 (0-100)
  score_coding    INTEGER DEFAULT 0,
  score_reasoning INTEGER DEFAULT 0,
  score_chinese   INTEGER DEFAULT 0,
  score_creative  INTEGER DEFAULT 0,
  score_speed     INTEGER DEFAULT 0,
  score_vision    INTEGER DEFAULT 0,      -- 0 = 不支持
  score_video     INTEGER DEFAULT 0,
  score_audio     INTEGER DEFAULT 0,

  -- 技术参数
  context_window  INTEGER,
  max_output      INTEGER,
  supports_tools  INTEGER DEFAULT 0,
  supports_json   INTEGER DEFAULT 0,

  -- 运营
  is_active       INTEGER DEFAULT 1,
  priority        INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

### MVP 初始数据

```sql
-- Starter
INSERT INTO model_scores VALUES ('mimo-v2.5', 'xiaomi', 'MiMo V2.5', 'starter',
  0.74, 1.96, NULL, 70, 65, 80, 72, 95, 75, 60, 55, 1048576, 16384, 1, 1, 1, 1,
  '全模态，首字0.21s');

-- Pro
INSERT INTO model_scores VALUES ('deepseek-v4-flash', 'deepseek', 'DeepSeek V4 Flash', 'pro',
  1.0, 2.0, 0.02, 85, 65, 80, 60, 85, 0, 0, 0, 1048576, 16384, 1, 1, 1, 2,
  '性价比主力');

-- ProMax
INSERT INTO model_scores VALUES ('glm-5.2', 'zhipu', 'GLM-5.2', 'promax',
  8.0, 28.0, 2.0, 95, 90, 85, 85, 70, 80, 0, 0, 1048576, 32768, 1, 1, 1, 3,
  '代码对标Claude Opus 4.6');
```

### 迭代路线

**V1（MVP）**: 纯规则引擎
- 中文关键词表 + 4 tier → 按套餐选模型
- 无 AI 分类，confidence 低时默认走 MEDIUM
- 先跑起来验证业务模型

**V2**: 加入成本阈值 + 基础 AI 兜底
- cost_quality_tradeoff 参数化
- 边缘请求用 Qwen-Turbo 做分类

**V3**: 数据驱动优化
- 收集真实请求的 tier 分布
- 分析哪些 tier 的模型选择被用户抱怨（通过重试/反馈）
- 自动调优 tier→model 映射

---

## 待讨论

1. **产品命名**: Pro/ProMax？还是中文名（基础版/专业版）？
2. **套餐定价**: ¥39/99/299 这组数字合理吗？需要算盈亏平衡
3. **超额策略**: 用完直接停？还是降级到免费模型？还是按量加钱？
4. **是否先接一个模型跑通**: DeepSeek 最便宜，先只接 DeepSeek 系列（V4-Flash + Chat + R1）三个档位跑通流程？

---

## 附：OpenRouter 研究关键发现

- **商业模式**: 不是吃差价，而是 pass-through 价格 + 5.5% 平台费。按量计费，不卖套餐。
- **Auto Router**: 由 NotDiamond 提供，一个 `cost_quality_tradeoff` 滑块（0-10）控制价格/质量权衡。
- **我们不学 OpenRouter 的按量计费模式**——我们是套餐制（订阅），因为国内用户习惯订阅而非 credits。

## 附：ClawRouter vs RouteLLM 结论

- **ClawRouter 关键词表已是中英双语**，不需要从零做中文适配。
- **RouteLLM 不适合主力**——它需要偏好数据训练，国内模型没有。但"成本阈值 gating"思想值得借鉴。
- **最终方案**: 规则分类（70-80%）+ 成本阈值 Gate + AI 兜底（20-30%）。
