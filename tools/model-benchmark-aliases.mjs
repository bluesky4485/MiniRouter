// 77个模型 → LLM Stats normalized_id 映射表
// 原则：只有 ID 精确匹配或高度一致才映射，模糊匹配不硬对
// 未映射的模型 = LLM Stats 无对应数据，保留手动评分
export const MODEL_BENCHMARK_ALIASES = {
  // ── DeepSeek ──
  "deepseek/v4-pro": "deepseek/deepseek-v4-pro-max",
  "deepseek/v4-flash": "deepseek/deepseek-v4-flash-max",
  "deepseek/v3.2": "deepseek/deepseek-v3.2",
  // v3.2-exp 和 v3.2-speciale 是不同变体，不做映射

  // ── MiniMax ──
  "minimax/m3": "minimax/minimax-m3",
  "minimax/m2.7": "minimax/minimax-m2.7",

  // ── 阿里千问 ──
  "alibaba/qwen3-coder-plus": "alibaba/qwen3-coder-480b-a35b-instruct",

  // ── Kimi / Moonshot ──
  "moonshot/kimi-k2.7-code-highspeed": "moonshot/kimi-k2.7-code",

  // ── Anthropic ──
  "anthropic/claude-opus-4.8": "anthropic/claude-opus-4-8",

  // ── Google ──
  "google/gemini-3-flash": "google/gemini-3-flash-preview",
};

export function benchmarkLookupId(modelId) {
  return MODEL_BENCHMARK_ALIASES[modelId] ?? modelId;
}
