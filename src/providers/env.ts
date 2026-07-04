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

/**
 * Pick a model slot for the request.
 *
 * Profile semantics (see docs/routing-strategy.md):
 *   - auto     → tier → slot (14-dim score decides; SIMPLE/MEDIUM→balanced, COMPLEX/REASONING→strong)
 *   - eco      → balanced (flash) regardless of tier — cost-optimized
 *   - premium  → strong (glm) regardless of tier — quality-optimized
 *
 * Vision requests always go to the vision slot first (for MiniCPM-V
 * preprocessing) regardless of profile — vision is a capability requirement,
 * not a difficulty signal.
 */
export function pickSlotForFeatures(
  slots: ModelSlots,
  input: {
    tier: Tier;
    profile?: "auto" | "eco" | "premium";
    requirements: {
      vision: boolean;
      toolCalling: boolean;
      agentic: boolean;
    };
  },
): ModelSlot {
  // Vision is a capability requirement — always the vision slot first.
  if (input.requirements.vision) {
    const visionSlot = slots.vision;
    if (visionSlot) return visionSlot;
    throw new Error("No configured vision slot can satisfy the request");
  }

  // Profile-driven slot selection (eco/premium override tier).
  const profileDefault: ModelSlotName | undefined =
    input.profile === "eco" ? "balanced" : input.profile === "premium" ? "strong" : undefined;

  const preferred: ModelSlotName[] = [];
  if (profileDefault) preferred.push(profileDefault);
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
