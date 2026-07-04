const CACHE_PRICE_RATIO = 0.186; // GLM-style cached input price: 0.26 / 1.40.
const OUTPUT_PRICE_RATIO = 4.4 / 1.4;

const scenarios = [
  {
    name: "short_agent_turn",
    description: "Short repeated agent turn with stable system/tools prefix.",
    staticPrefix: 12_000,
    dynamic: 1_000,
    output: 500,
    safeDynamicRatio: 0.9,
    forceTotalRatio: 0.8,
    cacheable: true,
  },
  {
    name: "long_tool_logs",
    description: "Agent request with large shell/tool logs appended after a stable prefix.",
    staticPrefix: 12_000,
    dynamic: 60_000,
    output: 1_000,
    safeDynamicRatio: 0.38,
    forceTotalRatio: 0.42,
    cacheable: true,
  },
  {
    name: "rag_docs",
    description: "Stable instructions plus long retrieved documents.",
    staticPrefix: 8_000,
    dynamic: 40_000,
    output: 1_200,
    safeDynamicRatio: 0.55,
    forceTotalRatio: 0.5,
    cacheable: true,
  },
  {
    name: "vision_observation",
    description: "Vision observation with OCR/numbers that should only be lightly compressed.",
    staticPrefix: 6_000,
    dynamic: 16_000,
    output: 900,
    safeDynamicRatio: 0.82,
    forceTotalRatio: 0.65,
    cacheable: true,
  },
  {
    name: "near_context_limit",
    description: "Huge dynamic payload near context limit; compression is mainly about fit.",
    staticPrefix: 10_000,
    dynamic: 160_000,
    output: 2_000,
    safeDynamicRatio: 0.35,
    forceTotalRatio: 0.38,
    cacheable: true,
  },
];

function inputCost(totalInput, cacheRead, cacheRatio = CACHE_PRICE_RATIO) {
  const uncached = Math.max(totalInput - cacheRead, 0);
  return uncached + cacheRead * cacheRatio;
}

function totalCost(input, cacheRead, output) {
  return inputCost(input, cacheRead) + output * OUTPUT_PRICE_RATIO;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function analyzeScenario(s) {
  const originalInput = s.staticPrefix + s.dynamic;
  const noCompressionCache = s.cacheable ? s.staticPrefix : 0;
  const noCompressionCost = totalCost(originalInput, noCompressionCache, s.output);

  const safeInput = s.staticPrefix + Math.ceil(s.dynamic * s.safeDynamicRatio);
  const safeCache = s.cacheable ? s.staticPrefix : 0;
  const safeCost = totalCost(safeInput, safeCache, s.output);

  const forceInput = Math.ceil(originalInput * s.forceTotalRatio);
  const forceCache = 0; // Full rewrite changes the cacheable prefix.
  const forceCost = totalCost(forceInput, forceCache, s.output);

  const dynamicSaved = s.dynamic - Math.ceil(s.dynamic * s.safeDynamicRatio);
  const cacheLostIfForce = noCompressionCache;
  const forceBreakEvenInput = cacheLostIfForce * (1 - CACHE_PRICE_RATIO);

  return {
    scenario: s.name,
    originalInput,
    noCompressionCache,
    noCompressionCost,
    safeInput,
    safeCache,
    safeCost,
    safeSavings: (noCompressionCost - safeCost) / noCompressionCost,
    forceInput,
    forceCache,
    forceCost,
    forceSavings: (noCompressionCost - forceCost) / noCompressionCost,
    dynamicSaved,
    cacheLostIfForce,
    forceBreakEvenInput,
    recommendation:
      safeCost <= noCompressionCost && safeCost <= forceCost
        ? "adaptive_safe"
        : forceCost < safeCost
          ? "force_only_if_quality_ok"
          : "no_compression",
  };
}

function printTable(rows) {
  console.log("scenario,no_input,no_cache,no_cost,safe_input,safe_cache,safe_cost,safe_savings,force_input,force_cache,force_cost,force_savings,recommendation");
  for (const r of rows) {
    console.log([
      r.scenario,
      r.originalInput,
      r.noCompressionCache,
      round(r.noCompressionCost),
      r.safeInput,
      r.safeCache,
      round(r.safeCost),
      pct(r.safeSavings),
      r.forceInput,
      r.forceCache,
      round(r.forceCost),
      pct(r.forceSavings),
      r.recommendation,
    ].join(","));
  }
}

function printBreakEven(rows) {
  console.log("\nBreak-even notes:");
  for (const r of rows) {
    console.log(
      `- ${r.scenario}: force compression loses ${r.cacheLostIfForce} cached tokens, worth ${round(r.forceBreakEvenInput)} uncached input tokens. ` +
        `Force must save more than that before quality/latency costs to beat cached no-compression.`,
    );
  }
}

function printPolicy() {
  console.log("\nPolicy derived from experiment:");
  console.log("- Keep system/tools/static prefix uncompressed whenever cache is possible.");
  console.log("- Compress dynamic tails: tool_result, logs, diffs, RAG docs, large file contents.");
  console.log("- Do not compress short turns; cache wins and compression adds variance.");
  console.log("- Lightly compress vision observations; do not compress OCR numbers/tables aggressively.");
  console.log("- Use force only for context-fit emergencies or explicit experiments.");
}

const rows = scenarios.map(analyzeScenario);
printTable(rows);
printBreakEven(rows);
printPolicy();
