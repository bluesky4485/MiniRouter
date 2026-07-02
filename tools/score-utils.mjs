export function percentScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return Math.round(n <= 1 ? n * 100 : n);
}

export function averageScore(values) {
  const scores = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

export function weightedScore(signals) {
  let weighted = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const value = percentScore(signal.value);
    if (value == null) continue;
    weighted += value * signal.weight;
    totalWeight += signal.weight;
  }

  if (totalWeight === 0) return null;
  return Math.round(weighted / totalWeight);
}

export function abilityScoresFromLlmStats(model) {
  const coding = weightedScore([
    { value: model.swe_bench_verified_score, weight: 0.45 },
    { value: model.swe_bench_pro_score, weight: 0.25 },
    { value: model.scicode_score, weight: 0.15 },
    { value: model.terminal_bench_score, weight: 0.1 },
    { value: model.coding_arena_score ?? model.index_code, weight: 0.05 },
  ]);
  const reasoning = weightedScore([
    { value: model.gpqa_score, weight: 0.35 },
    { value: model.aime_2025_score, weight: 0.25 },
    { value: model.hle_score, weight: 0.15 },
    { value: model.frontiermath_score, weight: 0.1 },
    { value: model.arc_agi_v2_score, weight: 0.05 },
    { value: model.index_reasoning ?? model.index_math, weight: 0.1 },
  ]);
  const chinese = weightedScore([
    { value: model.mmmlu_score, weight: 0.8 },
    { value: model.simpleqa_score, weight: 0.2 },
  ]);

  return {
    coding,
    reasoning,
    chinese,
    overall: averageScore([coding, reasoning, chinese]),
  };
}
