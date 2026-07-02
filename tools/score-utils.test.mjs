import { describe, expect, it } from "vitest";

import { abilityScoresFromLlmStats, averageScore, percentScore, weightedScore } from "./score-utils.mjs";

describe("score-utils", () => {
  it("keeps missing benchmark values as null instead of zero", () => {
    expect(percentScore(null)).toBeNull();
    expect(percentScore(undefined)).toBeNull();
    expect(percentScore(Number.NaN)).toBeNull();
  });

  it("normalizes fractional benchmark scores to 0-100 points", () => {
    expect(percentScore(0.642)).toBe(64);
    expect(percentScore(79)).toBe(79);
  });

  it("computes overall from available ability scores only", () => {
    expect(averageScore([64, 79, null])).toBe(72);
    expect(averageScore([null, null])).toBeNull();
  });

  it("computes weighted scores from available benchmark signals", () => {
    expect(
      weightedScore([
        { value: 0.8, weight: 0.75 },
        { value: 0.6, weight: 0.25 },
        { value: null, weight: 1 },
      ]),
    ).toBe(75);
  });

  it("maps selected LLM Stats benchmark fields into dashboard ability scores", () => {
    expect(
      abilityScoresFromLlmStats({
        swe_bench_verified_score: 0.642,
        scicode_score: 0.417,
        gpqa_score: 0.791,
        hle_score: 0.144,
        mmmlu_score: null,
      }),
    ).toEqual({
      coding: 58,
      reasoning: 60,
      chinese: null,
      overall: 59,
    });
  });
});
