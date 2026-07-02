import { describe, expect, it } from "vitest";

import { mapModelScoreRow } from "./models-api.js";
import type { modelScores } from "../../db/schema.js";

type ModelScoreRow = typeof modelScores.$inferSelect;

describe("mapModelScoreRow", () => {
  it("returns the dashboard shape from a model_scores row", () => {
    const row: ModelScoreRow = {
      id: "zhipu/glm-4.5",
      provider: "Zhipu AI",
      displayName: "GLM-4.5",
      type: "domestic",
      priceInput: 0.8,
      priceOutput: 2,
      priceCacheHit: null,
      peakMultiplier: null,
      peakHours: null,
      tokenPlan: null,
      scoreCoding: 64,
      scoreReasoning: 79,
      scoreChinese: 0,
      scoreCreative: 0,
      scoreSpeed: 0,
      scoreOverall: 72,
      hasVision: 1,
      hasVideo: 0,
      hasAudio: 0,
      contextWindow: 131072,
      maxOutput: 8192,
      supportsTools: 1,
      supportsJson: 1,
      orRank: null,
      orWeeklyVolume: null,
      orWeeklyChange: null,
      isActive: 1,
      priority: 10,
      releaseDate: "2026-07",
      notes: "Imported from LLM Stats",
      verified: 1,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    };

    expect(mapModelScoreRow(row)).toMatchObject({
      id: "zhipu/glm-4.5",
      provider: "Zhipu AI",
      displayName: "GLM-4.5",
      type: "domestic",
      dataStatus: "confirmed",
      pricing: {
        input: 0.8,
        output: 2,
        cacheHit: null,
      },
      scores: {
        coding: 64,
        reasoning: 79,
        chinese: 0,
      },
      multimodal: {
        vision: true,
        video: false,
        audio: false,
      },
      specs: {
        contextWindow: 131072,
        maxOutput: 8192,
        supportsTools: true,
        supportsJson: true,
      },
      isActive: true,
      verified: true,
    });
  });
});
