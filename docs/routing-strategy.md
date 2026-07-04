# MiniRouter 路由策略

本文档定义 MiniRouter 的完整路由策略，作为开发的权威依据。代码实现应与本文档一致。

## 一、三套机制分工

```
客户端请求
  ↓
1. profile 判定（由 model 名或 header 决定）
   - auto    → 启用 14 维打分判难度
   - eco     → 全走快速 slot（不论难度）
   - premium → 全走高智 slot（不论难度）
  ↓
2. 视觉预处理（所有模式，独立于 profile）
   - 带图片/视频 → 先走 vision slot（MiniCPM-V）生成文本观察
   - strip 掉 image 块，把观察注入为 text
   - 视觉是能力要求，不参与难度判断
  ↓
3. 难度判定（仅 auto 模式）
   - 14 维加权打分 → tier（SIMPLE/MEDIUM/COMPLEX/REASONING）
   - 无硬覆盖（已删除 maxTokensForceComplex / reasoning 关键词硬覆盖）
  ↓
4. slot 选择
   - auto:    tier → slot（SIMPLE/MEDIUM→balanced，COMPLEX/REASONING→strong）
   - eco:     不论 tier → balanced（vision 请求走 vision）
   - premium: 不论 tier → strong（vision 请求走 vision）
  ↓
5. effort 透传（所有模式）
   - output_config.effort 原样发给上游 API，控制模型思考程度
   - 不参与模型选择
```

## 二、profile 触发方式

| 客户端发 | 触发 profile |
|---|---|
| `model: "minirouter/auto"` | auto |
| `model: "minirouter/eco"` | eco |
| `model: "minirouter/premium"` | premium |
| header `x-routing-profile: eco/premium` | 对应 profile |
| 无 / 其它 | auto（默认）|

## 三、auto 模式的难度判定（14 维加权打分）

### 打分维度（14 维，权重见 config.ts scoring）

1. tokenCount（上下文长度）
2. codePresence（代码关键词）
3. reasoningMarkers（推理词：证明/分析/规划/逻辑…）
4. technicalTerms（技术词）
5. creativeMarkers（创作词）
6. simpleIndicators（简单词：你好/翻译…）
7. multiStepPatterns（"先…然后/步骤N"）
8. questionComplexity（问号 >3 个）
9. imperativeVerbs（命令动词）
10. constraintCount（约束条件）
11. outputFormat（格式要求）
12. references（引用复杂度）
13. negationComplexity（否定嵌套）
14. domainSpecificity（领域专用词）

每个维度返回 [-1, 1] 分数，乘权重求和得 `weightedScore`。

### tier 边界（config.ts tierBoundaries）

```
score < 0.0   → SIMPLE
0.0 ≤ score < 0.3  → MEDIUM
0.3 ≤ score < 0.5  → COMPLEX
score ≥ 0.5   → REASONING
```

### 置信度

- 距边界远 → 高置信（直接定 tier）
- 距边界近 → 低置信 → ambiguous（走 `ambiguousDefaultTier` = MEDIUM）

### 已删除的硬覆盖（不再生效）

- ~~`maxTokensForceComplex`（100K 强制 COMPLEX）~~ — 删除，让 14 维的 tokenCount 维度自己判
- ~~reasoning 关键词 ≥2 强制 REASONING~~ — 删除，让 reasoningMarkers 维度自己加权
- ~~`effort:xhigh/max` 强制 REASONING~~ — 删除，effort 完全脱钩模型选择

## 四、tier → slot 映射（.env slot 模式）

| tier | slot | .env 模型 |
|---|---|---|
| SIMPLE | balanced | deepseek/deepseek-v4-flash |
| MEDIUM | balanced | deepseek/deepseek-v4-flash |
| COMPLEX | strong | bigmodel/glm-5.2 |
| REASONING | strong | bigmodel/glm-5.2 |
| （视觉）| vision | minicpm-v-4.6-thinking |

**现状说明**：四档 tier 在 .env slot 模式下实际只有两档（balanced/strong）。COMPLEX/REASONING 的区分留给将来接 model_scores 数据库时使用（不同难度选不同模型）。

## 五、视觉请求（所有模式，独立于 profile）

带 image/video 的请求：

1. 先走 vision slot（MiniCPM-V）做视觉预处理，生成文本观察
2. strip 掉 image/video 块，把观察注入为 text 块
3. 主请求按 profile 选 slot（auto 模式还要按 14 维判 tier）

**关键**：视觉是**能力要求**，不参与难度判断。不论 auto/eco/premium，带视觉都先走 vision slot 预处理。

## 六、effort 字段

- **只透传给上游 API**，控制模型思考程度（thinking 深度）
- **不参与模型选择**
- 官方 5 档：`low / medium / high / xhigh / max`
- `high` 是 API 默认值（Claude Code 默认发 high），不触发任何路由行为
- 所有 effort 值原样透传，路由层不读

## 七、profile 与 slot 选择的关系

`pickSlotForFeatures` 读 profile：

| profile | 默认 slot | 视觉请求 |
|---|---|---|
| auto | tier → slot（14 维判） | vision |
| eco | balanced（flash） | vision |
| premium | strong（glm） | vision |

## 八、原生透传原则

- 请求体原则上原样透传，只替换 `model` 字段
- adapter 只修已知的兼容性 bug（如 `fixEmptyImageDetail`）
- `thinking` 字段原样透传（不删）
- `effort` 字段原样透传（不读、不改）

## 九、配置位置

- profile 触发：[chat.ts](../src/server/routes/chat.ts) `routingProfile()` / [anthropic-messages.ts](../src/server/routes/anthropic-messages.ts)
- 14 维打分：[rules.ts](../src/router/rules.ts) `classifyByRules()`
- 打分配置：[config.ts](../src/router/config.ts) `scoring`
- slot 选择：[env.ts](../src/providers/env.ts) `pickSlotForFeatures()`
- effort 透传：[anthropic-messages.ts](../src/server/routes/anthropic-messages.ts) `readEffort()`（只提取，不参与判定）
