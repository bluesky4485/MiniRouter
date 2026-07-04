import type { ModelSlot, ModelSlotName, ModelSlots, ProviderKind } from "./types.js";
import type { Tier } from "../router/types.js";

const SLOT_NAMES: ModelSlotName[] = ["fast", "balanced", "strong", "vision"];

type EnvLike = Record<string, string | undefined>;

function readBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "yes";
}

function readProvider(value: string | undefined): ProviderKind {
  if (value === "anthropic") return "anthropic";
  if (value === "openai-compatible") return "openai-compatible";
  return "auto";
}

function readSlot(env: EnvLike, slot: ModelSlotName): ModelSlot | undefined {
  const prefix = `MINIROUTER_${slot.toUpperCase()}`;
  const baseUrl = env[`${prefix}_BASE_URL`];
  const apiKey = env[`${prefix}_API_KEY`];
  const model = env[`${prefix}_MODEL`];

  if (!baseUrl || !apiKey || !model) {
    return undefined;
  }

  return {
    slot,
    provider: readProvider(env[`${prefix}_PROVIDER`]),
    baseUrl,
    apiKey,
    model,
    supportsTools: readBool(env[`${prefix}_SUPPORTS_TOOLS`], true),
    supportsVision: readBool(env[`${prefix}_SUPPORTS_VISION`], slot === "vision"),
    contextWindowTokens: env[`${prefix}_CONTEXT_WINDOW`]
      ? Number(env[`${prefix}_CONTEXT_WINDOW`])
      : undefined,
  };
}

export function loadModelSlotsFromEnv(env: EnvLike = process.env): ModelSlots {
  const slots: ModelSlots = {};
  for (const slot of SLOT_NAMES) {
    const config = readSlot(env, slot);
    if (config) slots[slot] = config;
  }
  return slots;
}

export function getSlotForRoutingModel(slots: ModelSlots, model: string): ModelSlot | undefined {
  const match = model.toLowerCase().match(/^minirouter\/slot\/(fast|balanced|strong|vision)$/);
  if (!match) return undefined;
  return slots[match[1] as ModelSlotName];
}

function tierSlot(tier: Tier): ModelSlotName {
  if (tier === "SIMPLE") return "balanced";
  if (tier === "MEDIUM") return "balanced";
  return "strong";
}

export function pickSlotForFeatures(
  slots: ModelSlots,
  input: {
    tier: Tier;
    requirements: {
      vision: boolean;
      toolCalling: boolean;
      agentic: boolean;
    };
  },
): ModelSlot {
  if (input.requirements.vision) {
    const visionSlot = slots.vision;
    if (visionSlot) return visionSlot;
    throw new Error("No configured vision slot can satisfy the request");
  }

  const preferred: ModelSlotName[] = [];
  if (input.requirements.toolCalling || input.requirements.agentic) {
    preferred.push(input.tier === "COMPLEX" || input.tier === "REASONING" ? "strong" : "balanced");
  }
  preferred.push(tierSlot(input.tier), "balanced", "strong");

  for (const slot of preferred) {
    const candidate = slots[slot];
    if (!candidate) continue;
    if (input.requirements.toolCalling && !candidate.supportsTools) continue;
    return candidate;
  }

  throw new Error("No configured model slot can satisfy the request");
}
