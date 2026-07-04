import { afterEach, describe, expect, it } from "vitest";

import { getSlotForRoutingModel, loadModelSlotsFromEnv, pickSlotForFeatures } from "./env.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadModelSlotsFromEnv", () => {
  it("loads configured model slots from environment variables", () => {
    process.env["MINIROUTER_FAST_BASE_URL"] = "https://api.example.com/v1";
    process.env["MINIROUTER_FAST_API_KEY"] = "fast-key";
    process.env["MINIROUTER_FAST_MODEL"] = "glm-4.7-flash";
    process.env["MINIROUTER_FAST_SUPPORTS_TOOLS"] = "false";
    process.env["MINIROUTER_FAST_SUPPORTS_VISION"] = "false";

    const slots = loadModelSlotsFromEnv();

    expect(slots.fast).toMatchObject({
      slot: "fast",
      provider: "auto",
      baseUrl: "https://api.example.com/v1",
      apiKey: "fast-key",
      model: "glm-4.7-flash",
      supportsTools: false,
      supportsVision: false,
    });
  });

  it("keeps explicit provider overrides for native Anthropic endpoints", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_STRONG_PROVIDER: "anthropic",
      MINIROUTER_STRONG_BASE_URL: "https://api.anthropic.com/v1",
      MINIROUTER_STRONG_API_KEY: "strong-key",
      MINIROUTER_STRONG_MODEL: "claude-sonnet",
    });

    expect(slots.strong?.provider).toBe("anthropic");
  });
});

describe("pickSlotForFeatures", () => {
  it("uses balanced as the MVP default when the fast slot is not configured", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_BALANCED_PROVIDER: "openai-compatible",
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
      MINIROUTER_BALANCED_SUPPORTS_TOOLS: "true",
      MINIROUTER_STRONG_PROVIDER: "openai-compatible",
      MINIROUTER_STRONG_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_STRONG_API_KEY: "strong-key",
      MINIROUTER_STRONG_MODEL: "glm-5.2",
    });

    const selected = pickSlotForFeatures(slots, {
      tier: "SIMPLE",
      requirements: {
        vision: false,
        toolCalling: false,
        agentic: false,
      },
    });

    expect(selected.slot).toBe("balanced");
    expect(selected.model).toBe("deepseek-v4-flash");
  });

  it("keeps fast reserved and uses balanced for automatic simple requests even when fast is configured", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_FAST_PROVIDER: "openai-compatible",
      MINIROUTER_FAST_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_FAST_API_KEY: "fast-key",
      MINIROUTER_FAST_MODEL: "glm-4.7-flash",
      MINIROUTER_BALANCED_PROVIDER: "openai-compatible",
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
    });

    const selected = pickSlotForFeatures(slots, {
      tier: "SIMPLE",
      requirements: {
        vision: false,
        toolCalling: false,
        agentic: false,
      },
    });

    expect(selected.slot).toBe("balanced");
    expect(selected.model).toBe("deepseek-v4-flash");
  });

  it("used to route vision requests to the vision slot — now vision is preprocessed so it goes to balanced/strong", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_FAST_PROVIDER: "openai-compatible",
      MINIROUTER_FAST_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_FAST_API_KEY: "fast-key",
      MINIROUTER_FAST_MODEL: "glm-4.7-flash",
      MINIROUTER_BALANCED_PROVIDER: "openai-compatible",
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
      MINIROUTER_VISION_PROVIDER: "openai-compatible",
      MINIROUTER_VISION_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_VISION_API_KEY: "vision-key",
      MINIROUTER_VISION_MODEL: "glm-4.6v",
    });

    const selected = pickSlotForFeatures(slots, {
      tier: "SIMPLE",
      requirements: {
        vision: false,
        toolCalling: false,
        agentic: false,
      },
    });

    expect(selected.slot).toBe("balanced");
    expect(selected.model).toBe("deepseek-v4-flash");
  });

  it("routes vision+tool requests to balanced/strong after vision preprocessing strips images", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_BALANCED_PROVIDER: "openai-compatible",
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
      MINIROUTER_BALANCED_SUPPORTS_TOOLS: "true",
      MINIROUTER_STRONG_PROVIDER: "openai-compatible",
      MINIROUTER_STRONG_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_STRONG_API_KEY: "strong-key",
      MINIROUTER_STRONG_MODEL: "glm-5.2",
      MINIROUTER_STRONG_SUPPORTS_TOOLS: "true",
      MINIROUTER_VISION_PROVIDER: "openai-compatible",
      MINIROUTER_VISION_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_VISION_API_KEY: "vision-key",
      MINIROUTER_VISION_MODEL: "glm-4.6v",
      MINIROUTER_VISION_SUPPORTS_TOOLS: "false",
      MINIROUTER_VISION_SUPPORTS_VISION: "true",
    });

    const selected = pickSlotForFeatures(slots, {
      tier: "REASONING",
      requirements: {
        vision: false,
        toolCalling: true,
        agentic: true,
      },
    });

    expect(selected.slot).toBe("strong");
    expect(selected.model).toBe("glm-5.2");
  });

  it("routes tool-using agent requests to the balanced slot when configured", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_FAST_PROVIDER: "openai-compatible",
      MINIROUTER_FAST_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_FAST_API_KEY: "fast-key",
      MINIROUTER_FAST_MODEL: "glm-4.7-flash",
      MINIROUTER_FAST_SUPPORTS_TOOLS: "false",
      MINIROUTER_BALANCED_PROVIDER: "openai-compatible",
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
      MINIROUTER_BALANCED_SUPPORTS_TOOLS: "true",
    });

    const selected = pickSlotForFeatures(slots, {
      tier: "MEDIUM",
      requirements: {
        vision: false,
        toolCalling: true,
        agentic: true,
      },
    });

    expect(selected.slot).toBe("balanced");
    expect(selected.model).toBe("deepseek-v4-flash");
  });

  it("routes reasoning requests to the strong slot", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_BALANCED_PROVIDER: "openai-compatible",
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
      MINIROUTER_STRONG_PROVIDER: "openai-compatible",
      MINIROUTER_STRONG_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_STRONG_API_KEY: "strong-key",
      MINIROUTER_STRONG_MODEL: "glm-5.2",
    });

    const selected = pickSlotForFeatures(slots, {
      tier: "REASONING",
      requirements: {
        vision: false,
        toolCalling: false,
        agentic: false,
      },
    });

    expect(selected.slot).toBe("strong");
    expect(selected.model).toBe("glm-5.2");
  });
});

describe("getSlotForRoutingModel", () => {
  it("returns an explicitly requested configured slot model", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
      MINIROUTER_STRONG_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_STRONG_API_KEY: "strong-key",
      MINIROUTER_STRONG_MODEL: "glm-5.2",
    });

    const selected = getSlotForRoutingModel(slots, "minirouter/slot/strong");

    expect(selected?.slot).toBe("strong");
    expect(selected?.model).toBe("glm-5.2");
  });

  it("returns undefined for virtual auto routing models", () => {
    const slots = loadModelSlotsFromEnv({
      MINIROUTER_BALANCED_BASE_URL: "https://api.example.com/v1",
      MINIROUTER_BALANCED_API_KEY: "balanced-key",
      MINIROUTER_BALANCED_MODEL: "deepseek-v4-flash",
    });

    expect(getSlotForRoutingModel(slots, "minirouter/auto")).toBeUndefined();
  });
});
