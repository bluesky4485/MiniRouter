import { describe, expect, it } from "vitest";
import { estimateUsdCostFromPricing, resolvePricingModelId } from "./cost.js";

describe("resolvePricingModelId", () => {
  it("maps common upstream aliases to canonical model score ids", () => {
    expect(resolvePricingModelId("glm-5.2")).toBe("zhipu/glm-5.2");
    expect(resolvePricingModelId("bigmodel/glm-5.2")).toBe("zhipu/glm-5.2");
    expect(resolvePricingModelId("deepseek-v4-flash")).toBe("deepseek/v4-flash");
    expect(resolvePricingModelId("deepseek/deepseek-v4-flash")).toBe("deepseek/v4-flash");
  });

  it("allows deployment-specific aliases from JSON env", () => {
    expect(
      resolvePricingModelId("vendor/custom-model", {
        MINIROUTER_PRICE_MODEL_ALIASES: JSON.stringify({
          "vendor/custom-model": "zhipu/glm-5.2",
        }),
      }),
    ).toBe("zhipu/glm-5.2");
  });
});

describe("estimateUsdCostFromPricing", () => {
  it("converts CNY-per-million token prices into USD request cost", () => {
    const result = estimateUsdCostFromPricing(
      {
        priceInputCnyPerMillion: 2,
        priceOutputCnyPerMillion: 8,
        priceCacheHitCnyPerMillion: 0.5,
      },
      {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 200_000,
      },
      { cnyPerUsd: 7.2 },
    );

    expect(result.costUsd).toBeCloseTo(0.791667, 6);
    expect(result.pricingStatus).toBe("priced");
  });

  it("returns zero with a missing-price marker when pricing is unavailable", () => {
    const result = estimateUsdCostFromPricing(
      {
        priceInputCnyPerMillion: null,
        priceOutputCnyPerMillion: null,
        priceCacheHitCnyPerMillion: null,
      },
      {
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
      },
      { cnyPerUsd: 7.2 },
    );

    expect(result).toEqual({ costUsd: 0, pricingStatus: "pricing_missing" });
  });
});
