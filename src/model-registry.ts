/**
 * MiniRouter 模型能力与价格数据库
 *
 * 这是整个路由系统的"数据底座"——所有路由决策、套餐定价、模型选择都基于此表。
 *
 * 更新规范：
 *   - 新模型上线 → 新增条目，标注 release_date
 *   - 价格变动 → 更新 price_* 字段，在 notes 里记录 "2026-07-XX 调价：旧价 ¥X→新价 ¥Y"
 *   - 模型废弃 → is_active = false，在 notes 里记录废弃原因
 *   - 能力评分 → 基于最新公开基准 + 实际使用反馈，季度重评
 *
 * 评分来源（优先级从高到低）：
 *   1. OpenRouter 真实用量排行（用户用脚投票）
 *   2. LiveCodeBench / SWE-bench（代码）
 *   3. AIME / GPQA（推理）
 *   4. AlignBench / C-Eval / SuperCLUE（中文）
 *   5. LMSys Chatbot Arena Elo（综合）
 *   6. 自身生产流量反馈（未来）
 */

export interface ModelEntry {
  /** 唯一 ID，格式: provider/model-name，如 "deepseek/v4-flash" */
  id: string;

  /** 厂商 */
  provider: string;

  /** 显示名称 */
  displayName: string;

  /** 建议归属档位: starter | pro | promax | candidate（待评估） */
  tier: "starter" | "pro" | "promax" | "candidate";

  // ── 价格（元/百万 Token）──
  pricing: {
    /** 输入价格（缓存未命中） */
    input: number;
    /** 输出价格 */
    output: number;
    /** 缓存命中价格，null = 不支持缓存 */
    cacheHit: number | null;
    /** 高峰时段价格倍数（如 DeepSeek 峰谷定价），null = 无峰谷 */
    peakMultiplier: number | null;
    /** 高峰时段说明 */
    peakHours: string | null;
    /** 是否有 Token 包/套餐，附链接或说明 */
    tokenPlan: string | null;
  };

  // ── 能力评分（0-100，基于公开基准 + 人工校准）──
  scores: {
    /** 代码能力：LiveCodeBench + SWE-bench */
    coding: number;
    /** 推理能力：AIME + GPQA */
    reasoning: number;
    /** 中文能力：AlignBench + C-Eval */
    chinese: number;
    /** 创意写作 */
    creative: number;
    /** 响应速度：首字延迟 + 吞吐量 */
    speed: number;
    /** 综合能力：LMSys Elo / 加权 */
    overall: number;
  };

  // ── 多模态支持 ──
  multimodal: {
    /** 视觉（图片理解） */
    vision: boolean;
    /** 视频理解 */
    video: boolean;
    /** 音频 */
    audio: boolean;
  };

  // ── 技术参数 ──
  specs: {
    /** 上下文窗口（tokens） */
    contextWindow: number;
    /** 最大输出 tokens */
    maxOutput: number;
    /** Function Calling / Tool Use */
    supportsTools: boolean;
    /** JSON / Structured Output */
    supportsJson: boolean;
  };

  // ── OpenRouter 热度（每周更新）──
  openrouter: {
    /** 本周排名，null = 未上榜 */
    rankThisWeek: number | null;
    /** 本周 token 量（文字描述） */
    weeklyVolume: string | null;
    /** 周环比变化，如 "+32%", "-5%" */
    weeklyChange: string | null;
  };

  // ── 运营状态 ──
  /** 是否可用于路由 */
  isActive: boolean;
  /** 同 tier 内优先级（越大越优先） */
  priority: number;
  /** 发布日期（用于判断新鲜度） */
  releaseDate: string;
  /** 备注（调价记录、故障记录等） */
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════
// 模型数据库
// ═══════════════════════════════════════════════════════════════════

export const MODEL_REGISTRY: ModelEntry[] = [
  // ─────────────────────────────────────────────────────────────
  // STARTER 档：极低成本 + 多模态 + 快速响应
  // ─────────────────────────────────────────────────────────────

  {
    id: "xiaomi/mimo-v2.5",
    provider: "小米 (Xiaomi)",
    displayName: "MiMo-V2.5",
    tier: "starter",
    pricing: {
      input: 0.74,
      output: 2.1,      // 应确认：不同来源有 ¥1.96 / ¥2.1
      cacheHit: 0.07,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: "订阅包 ¥39/月 0.6亿Credits",
    },
    scores: {
      coding: 70,
      reasoning: 65,
      chinese: 80,
      creative: 72,
      speed: 95,        // 首字 0.21s，极快
      overall: 76,
    },
    multimodal: {
      vision: true,
      video: true,
      audio: true,      // 全模态
    },
    specs: {
      contextWindow: 1_048_576,  // 1M
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 2,
      weeklyVolume: "4.25T tokens",
      weeklyChange: "+3%",
    },
    isActive: true,
    priority: 10,
    releaseDate: "2025-Q4",
    notes: "全模态+极快速度，OpenRouter #2。Starter 首选：体验好、功能全。",
  },

  {
    id: "bytedance/seed-1.6-flash",
    provider: "字节 (ByteDance)",
    displayName: "豆包 Seed-1.6-Flash",
    tier: "starter",
    pricing: {
      input: 0.075,
      output: 0.75,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 55,
      reasoning: 40,
      chinese: 72,
      creative: 58,
      speed: 70,
      overall: 59,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 32768,
      maxOutput: 8192,
      supportsTools: false,
      supportsJson: false,
    },
    openrouter: {
      rankThisWeek: null,   // 未上榜
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: true,
    priority: 5,
    releaseDate: "2026-Q1",
    notes: "全场最低价 ¥0.075。能力较弱，仅适合极简任务。可作为 Starter 降级兜底。",
  },

  {
    id: "zhipu/glm-4-flash",
    provider: "智谱 (Zhipu)",
    displayName: "GLM-4-Flash",
    tier: "starter",
    pricing: {
      input: 0,
      output: 0,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: "永久免费",
    },
    scores: {
      coding: 55,
      reasoning: 40,
      chinese: 70,
      creative: 55,
      speed: 60,
      overall: 56,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 131072,
      maxOutput: 8192,
      supportsTools: false,
      supportsJson: false,
    },
    openrouter: {
      rankThisWeek: null,
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: true,
    priority: 8,
    releaseDate: "2024-Q4",
    notes: "永久免费，零成本兜底。适合 SIMPLE 级请求，也可做前置路由分类。",
  },

  // ─────────────────────────────────────────────────────────────
  // PRO 档：性价比主力
  // ─────────────────────────────────────────────────────────────

  {
    id: "deepseek/v4-flash",
    provider: "DeepSeek",
    displayName: "DeepSeek V4 Flash",
    tier: "pro",
    pricing: {
      input: 1.0,
      output: 2.0,
      cacheHit: 0.02,
      peakMultiplier: 2.0,
      peakHours: "工作日 9:00-12:00, 14:00-18:00",
      tokenPlan: null,
    },
    scores: {
      coding: 85,
      reasoning: 65,
      chinese: 80,
      creative: 60,
      speed: 85,
      overall: 75,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 1_048_576,  // 1M
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 1,
      weeklyVolume: "4.88T tokens",
      weeklyChange: "+2%",
    },
    isActive: true,
    priority: 20,
    releaseDate: "2026-05",
    notes:
      "OpenRouter 全球 #1。Pro 档核心主力。⚠️ 7月中旬引入峰谷定价，高峰价格翻倍到 ¥2.0/4.0。建议配置：高峰时段自动降级到其他 Pro 模型。",
  },

  {
    id: "meituan/longcat-2.0",
    provider: "美团 (Meituan)",
    displayName: "LongCat-2.0",
    tier: "pro",
    pricing: {
      input: 2.0,
      output: 8.0,
      cacheHit: 0.04,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: "¥9.9/5000万Tokens, ¥399/10亿Tokens",
    },
    scores: {
      coding: 93,         // SWE-bench 59.5，超 GPT-5.5
      reasoning: 85,
      chinese: 82,
      creative: 70,
      speed: 75,
      overall: 85,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 1_048_576,  // 1M
      maxOutput: 131072,         // 128K
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 5,          // 以 Owl Alpha 匿名跑榜
      weeklyVolume: "2.91T tokens",
      weeklyChange: "+1%",
    },
    isActive: true,
    priority: 18,
    releaseDate: "2026-06-30",
    notes:
      "🆕 旗舰能力 Pro 价格！1.6T参数 MIT开源。代码 93 分接近 GLM-5.2(95)，价格只有 1/4。缓存命中可能免费(agent场景)。Pro+ 候选：可作为 Pro 档复杂任务的升级选项。",
  },

  {
    id: "tencent/hunyuan-turbos",
    provider: "腾讯 (Tencent)",
    displayName: "混元 TurboS",
    tier: "pro",
    pricing: {
      input: 0.8,
      output: 2.0,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 72,
      reasoning: 62,
      chinese: 78,
      creative: 68,
      speed: 80,
      overall: 72,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 131072,
      maxOutput: 8192,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: null,
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: true,
    priority: 12,
    releaseDate: "2025-Q4",
    notes: "¥0.8/2.0 极低价格，腾讯生态优势。可作为 DeepSeek 高峰时段的降级切换目标。",
  },

  {
    id: "alibaba/qwen3.5-plus",
    provider: "阿里 (Alibaba)",
    displayName: "通义千问 Qwen3.5-Plus",
    tier: "pro",
    pricing: {
      input: 0.8,
      output: 4.8,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 80,
      reasoning: 70,
      chinese: 88,
      creative: 78,
      speed: 75,
      overall: 78,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 1_048_576,  // 1M
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: null,
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: true,
    priority: 14,
    releaseDate: "2025-Q4",
    notes: "中文 88 分最高，1M 上下文 ¥0.8 输入。长文档场景首选。",
  },

  {
    id: "minimax/m3",
    provider: "MiniMax",
    displayName: "MiniMax M3",
    tier: "pro",
    pricing: {
      input: 2.1,
      output: 8.4,
      cacheHit: 0.42,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 80,
      reasoning: 72,
      chinese: 80,
      creative: 75,
      speed: 78,
      overall: 77,
    },
    multimodal: {
      vision: true,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 197000,
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 4,
      weeklyVolume: "3.62T tokens",
      weeklyChange: "+3%",
    },
    isActive: true,
    priority: 15,
    releaseDate: "2026-Q1",
    notes: "OpenRouter #4。缓存机制好（¥0.42）。视觉支持。pro 档多模态首选。",
  },

  {
    id: "deepseek/v4-pro",
    provider: "DeepSeek",
    displayName: "DeepSeek V4 Pro",
    tier: "pro",
    pricing: {
      input: 3.0,
      output: 6.0,
      cacheHit: 0.025,
      peakMultiplier: 2.0,
      peakHours: "工作日 9:00-12:00, 14:00-18:00",
      tokenPlan: null,
    },
    scores: {
      coding: 90,
      reasoning: 85,
      chinese: 80,
      creative: 68,
      speed: 70,
      overall: 79,
    },
    multimodal: {
      vision: true,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 131072,
      maxOutput: 32768,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 7,
      weeklyVolume: "2.2T tokens",
      weeklyChange: "0%",
    },
    isActive: true,
    priority: 16,
    releaseDate: "2026-05",
    notes:
      "综合旗舰。Pro档 REASONING 升级选项。⚠️ 峰谷定价。输出 ¥6.0 是旗舰中最便宜——输出密集型任务优先用它。",
  },

  // ─────────────────────────────────────────────────────────────
  // PROMAX 档：推理天花板
  // ─────────────────────────────────────────────────────────────

  {
    id: "zhipu/glm-5.2",
    provider: "智谱 (Zhipu)",
    displayName: "GLM-5.2",
    tier: "promax",
    pricing: {
      input: 8.0,
      output: 28.0,
      cacheHit: 2.0,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: "Coding Plan Pro ¥149/月, Max ¥469/月",
    },
    scores: {
      coding: 95,         // 对标 Claude Opus 4.6
      reasoning: 90,
      chinese: 85,
      creative: 85,
      speed: 70,
      overall: 85,
    },
    multimodal: {
      vision: true,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 1_048_576,  // 1M
      maxOutput: 32768,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 6,
      weeklyVolume: "2.38T tokens",
      weeklyChange: "+32%",       // ⚡增长最快之列
    },
    isActive: true,
    priority: 30,
    releaseDate: "2026-06-17",
    notes:
      "ProMax 推理天花板。代码 95 分（LiveCodeBench 对标 Opus 4.6），1M 上下文。+32% 增长势头强劲。成本高，仅用于 COMPLEX+REASONING 级请求。",
  },

  {
    id: "alibaba/qwen3.6-max",
    provider: "阿里 (Alibaba)",
    displayName: "通义千问 Qwen3.6-Max",
    tier: "promax",
    pricing: {
      input: 2.5,         // 0-32K档
      output: 10.0,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 88,
      reasoning: 88,
      chinese: 92,         // 中文最强
      creative: 85,
      speed: 72,
      overall: 85,
    },
    multimodal: {
      vision: true,
      video: true,
      audio: false,
    },
    specs: {
      contextWindow: 262144,
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: null,   // 中文模型在 OpenRouter 曝光较少
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: true,
    priority: 25,
    releaseDate: "2026-Q2",
    notes:
      "中文 92 分断层第一。综合能力 85 分与 GLM-5.2 持平，但输入便宜 70%。ProMax 中文创意/写作场景首选。⚠️ 长文本(>128K)价格跳涨到 ¥7.0/28.0。",
  },

  {
    id: "bytedance/seed-2.0-pro",
    provider: "字节 (ByteDance)",
    displayName: "豆包 Seed-2.0-Pro",
    tier: "promax",
    pricing: {
      input: 3.2,
      output: 16.0,
      cacheHit: 0.8,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: "Batch 享 45% 折扣",
    },
    scores: {
      coding: 78,
      reasoning: 80,
      chinese: 85,
      creative: 80,
      speed: 75,
      overall: 80,
    },
    multimodal: {
      vision: true,
      video: true,
      audio: false,
    },
    specs: {
      contextWindow: 131072,
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: null,
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: true,
    priority: 22,
    releaseDate: "2026-Q2",
    notes: "字节旗舰。Batch 45% 折扣适合离线批量任务。多模态（图片+视频）。",
  },

  // ─────────────────────────────────────────────────────────────
  // CANDIDATE 档：跟踪观察，未正式入池
  // ─────────────────────────────────────────────────────────────

  {
    id: "tencent/hy3-preview",
    provider: "腾讯 (Tencent)",
    displayName: "混元 Hy3 Preview",
    tier: "candidate",
    pricing: {
      input: -1,          // 价格待确认
      output: -1,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 82,         // 预估
      reasoning: 78,
      chinese: 82,
      creative: 75,
      speed: 72,
      overall: 78,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 131072,
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 3,
      weeklyVolume: "3.75T tokens",
      weeklyChange: "+9%",
    },
    isActive: false,     // ⚠️ 候选，待价格确认后激活
    priority: 0,
    releaseDate: "2026-06",
    notes: "OpenRouter #3，预览版冲榜速度极快。待正式发布 + 价格确认后评估加入 Pro 或 ProMax 池。",
  },

  {
    id: "stepfun/step-3.7-flash",
    provider: "阶跃星辰 (StepFun)",
    displayName: "Step 3.7 Flash",
    tier: "candidate",
    pricing: {
      input: -1,          // 价格待确认
      output: -1,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 75,         // 预估
      reasoning: 72,
      chinese: 78,
      creative: 70,
      speed: 75,
      overall: 74,
    },
    multimodal: {
      vision: false,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 131072,
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: 11,
      weeklyVolume: "1.49T tokens",
      weeklyChange: "+16%",
    },
    isActive: false,
    priority: 0,
    releaseDate: "2026-Q2",
    notes: "OpenRouter #11 +16% 增长。黑马候选，待价格确认。",
  },

  {
    id: "moonshot/kimi-k2.6",
    provider: "月之暗面 (Moonshot)",
    displayName: "Kimi K2.6",
    tier: "candidate",
    pricing: {
      input: 6.5,
      output: 27.0,
      cacheHit: 1.1,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: "Andante ¥49/月, Moderato ¥99/月, Allegro ¥699/月",
    },
    scores: {
      coding: 90,
      reasoning: 75,
      chinese: 78,
      creative: 82,
      speed: 65,
      overall: 78,
    },
    multimodal: {
      vision: true,
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 262144,
      maxOutput: 16384,
      supportsTools: true,
      supportsJson: true,
    },
    openrouter: {
      rankThisWeek: null,
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: false,
    priority: 0,
    releaseDate: "2026-Q1",
    notes:
      "代码 90 分但输出 ¥27 太贵。缓存命中 ¥1.1 还行。价格/能力比不如 LongCat-2.0。暂列候选，等降价后重新评估。",
  },

  {
    id: "baidu/ernie-4.5-turbo",
    provider: "百度 (Baidu)",
    displayName: "文心 ERNIE 4.5 Turbo",
    tier: "candidate",
    pricing: {
      input: 0.8,
      output: 3.2,
      cacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
    },
    scores: {
      coding: 65,
      reasoning: 55,
      chinese: 85,
      creative: 72,
      speed: 70,
      overall: 69,
    },
    multimodal: {
      vision: true,       // VL 变体单独计费
      video: false,
      audio: false,
    },
    specs: {
      contextWindow: 131072,
      maxOutput: 8192,
      supportsTools: true,
      supportsJson: false,
    },
    openrouter: {
      rankThisWeek: null,
      weeklyVolume: null,
      weeklyChange: null,
    },
    isActive: false,
    priority: 0,
    releaseDate: "2026-Q1",
    notes:
      "¥0.80 便宜，中文 85 分好。但代码/推理偏弱，API 兼容性稍差（需适配器）。暂列候选，中文轻量场景可考虑。",
  },
];

// ═══════════════════════════════════════════════════════════════════
// 辅助查询函数
// ═══════════════════════════════════════════════════════════════════

/** 按档位获取可用模型 */
export function getModelsByTier(tier: ModelEntry["tier"]): ModelEntry[] {
  return MODEL_REGISTRY
    .filter((m) => m.tier === tier && m.isActive)
    .sort((a, b) => b.priority - a.priority);
}

/** 获取所有活跃模型 */
export function getActiveModels(): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.isActive);
}

/** 按 ID 查找模型 */
export function getModelById(id: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

/** 按厂商查找模型 */
export function getModelsByProvider(provider: string): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.provider.includes(provider));
}

/** 过滤支持多模态的模型 */
export function getMultimodalModels(feature: "vision" | "video" | "audio"): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.isActive && m.multimodal[feature]);
}

/** 获取支持 Function Calling 的模型 */
export function getToolCallingModels(): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.isActive && m.specs.supportsTools);
}

// ═══════════════════════════════════════════════════════════════════
// 价格区间统计（用于套餐定价）
// ═══════════════════════════════════════════════════════════════════

export const PRICING_STATS = {
  /** 最便宜输入价 */
  cheapestInput: 0,       // GLM-4-Flash 免费
  /** 最便宜输出价 */
  cheapestOutput: 0,
  /** 旗舰中位输入价 */
  flagshipMedianInput: 3.1,
  /** 旗舰中位输出价 */
  flagshipMedianOutput: 13.0,
  /** 价格跨度 */
  inputRange: "¥0 ~ ¥8.0 / 百万Token",
  outputRange: "¥0 ~ ¥28.0 / 百万Token",

  /** 假设请求分布下各档位加权成本 */
  estimatedCostPerRequest: {
    starter: "~¥0.0003-0.001 (SIMPLE 用免费/¥0.075模型)",
    pro: "~¥0.002-0.005 (MEDIUM 用 DL V4-Flash ¥1.0)",
    promax: "~¥0.005-0.015 (COMPLEX 用 LongCat/GLM-5.2)",    },
};
