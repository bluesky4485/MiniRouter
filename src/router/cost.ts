export type TokenUsageForCost = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
};

export type ModelPricingForCost = {
  priceInputCnyPerMillion: number | null | undefined;
  priceOutputCnyPerMillion: number | null | undefined;
  priceCacheHitCnyPerMillion?: number | null;
};

export type CostEstimate = {
  costUsd: number;
  pricingStatus: "priced" | "pricing_missing";
};

const DEFAULT_PRICE_MODEL_ALIASES: Record<string, string> = {
  "glm-5.2": "zhipu/glm-5.2",
  "bigmodel/glm-5.2": "zhipu/glm-5.2",
  "opencode-go/glm-5.2": "zhipu/glm-5.2",
  "deepseek-v4-flash": "deepseek/v4-flash",
  "deepseek/deepseek-v4-flash": "deepseek/v4-flash",
  "opencode-go/deepseek-v4-flash": "deepseek/v4-flash",
  "deepseek-v4-pro": "deepseek/v4-pro",
  "deepseek/deepseek-v4-pro": "deepseek/v4-pro",
  "opencode-go/deepseek-v4-pro": "deepseek/v4-pro",
};

function safeTokenCount(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : 0;
}

function safePrice(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function readCnyPerUsd(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env["MINIROUTER_CNY_PER_USD"]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7.2;
}

function readEnvAliases(env: Record<string, string | undefined>): Record<string, string> {
  const raw = env["MINIROUTER_PRICE_MODEL_ALIASES"];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function resolvePricingModelId(
  model: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const aliases = { ...DEFAULT_PRICE_MODEL_ALIASES, ...readEnvAliases(env) };
  return aliases[model] ?? model;
}

export function estimateUsdCostFromPricing(
  pricing: ModelPricingForCost,
  usage: TokenUsageForCost,
  options: { cnyPerUsd?: number } = {},
): CostEstimate {
  const inputPrice = safePrice(pricing.priceInputCnyPerMillion);
  const outputPrice = safePrice(pricing.priceOutputCnyPerMillion);
  if (inputPrice === undefined || outputPrice === undefined) {
    return { costUsd: 0, pricingStatus: "pricing_missing" };
  }

  const cachePrice = safePrice(pricing.priceCacheHitCnyPerMillion) ?? inputPrice;
  const cnyPerUsd = options.cnyPerUsd && options.cnyPerUsd > 0 ? options.cnyPerUsd : 7.2;
  const inputTokens = safeTokenCount(usage.inputTokens);
  const outputTokens = safeTokenCount(usage.outputTokens);
  const cacheReadTokens = safeTokenCount(usage.cacheReadTokens);
  const billableInputTokens = Math.max(0, inputTokens - cacheReadTokens);

  const costCny =
    (billableInputTokens / 1_000_000) * inputPrice +
    (cacheReadTokens / 1_000_000) * cachePrice +
    (outputTokens / 1_000_000) * outputPrice;

  return { costUsd: costCny / cnyPerUsd, pricingStatus: "priced" };
}

export async function estimateUsdCostForModel(
  model: string,
  usage: TokenUsageForCost,
  env: Record<string, string | undefined> = process.env,
): Promise<CostEstimate> {
  const pricingModelId = resolvePricingModelId(model, env);
  const [{ eq }, { getDb }, { modelScores }] = await Promise.all([
    import("drizzle-orm"),
    import("../db/connection.js"),
    import("../db/schema.js"),
  ]);
  const rows = await getDb()
    .select({
      priceInput: modelScores.priceInput,
      priceOutput: modelScores.priceOutput,
      priceCacheHit: modelScores.priceCacheHit,
    })
    .from(modelScores)
    .where(eq(modelScores.id, pricingModelId))
    .limit(1);

  const row = rows[0];
  return estimateUsdCostFromPricing(
    {
      priceInputCnyPerMillion: row?.priceInput,
      priceOutputCnyPerMillion: row?.priceOutput,
      priceCacheHitCnyPerMillion: row?.priceCacheHit,
    },
    usage,
    { cnyPerUsd: readCnyPerUsd(env) },
  );
}
