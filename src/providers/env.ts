import type { ModelSlot, ModelSlotName, ModelSlots, ProviderKind } from "./types.js";
import type { Tier } from "../router/types.js";
import { listProviderInstances } from "../db/queries/provider-instances.js";
import { hasViableChannelFor, type ProviderChannel } from "./channels.js";

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
    // provider="auto" means "adapt to the incoming request protocol".
    // The actual filtering happens in pickSlotForFeatures using the `protocol` argument.
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

/**
 * Load slots from env, and also discover any additional slots that have
 * DB channels. This lets users manage everything via Admin UI (DB) without
 * necessarily having every MINIROUTER_FAST_* etc defined.
 * Discovered slots are given provider="auto" so DB providerKind decides.
 */
export async function loadEffectiveModelSlots(
  env: EnvLike = process.env,
  options: { discoverFromDb?: boolean } = {}
): Promise<ModelSlots> {
  const fromEnv = loadModelSlotsFromEnv(env);
  const slots: ModelSlots = { ...fromEnv };

  if (options.discoverFromDb !== false) {
    try {
      const allChannels = await listProviderInstances(); // small table
      for (const ch of allChannels) {
        if (!ch.isHealthy) continue;
        const s = ch.slot;
        if (!slots[s]) {
          slots[s] = {
            slot: s,
            provider: "auto",
            baseUrl: "",
            apiKey: "",
            model: "",
            supportsTools: true,
            supportsVision: s === "vision",
            contextWindowTokens: undefined,
          };
        }
      }
    } catch {
      // DB not ready or no channels; ignore
    }
  }
  return slots;
}

export function getSlotForRoutingModel(slots: ModelSlots, model: string): ModelSlot | undefined {
  const match = model.toLowerCase().match(/^minirouter\/slot\/(fast|balanced|strong|vision)$/);
  if (!match) return undefined;
  return slots[match[1] as ModelSlotName];
}

function tierSlot(tier: Tier): ModelSlotName {
  if (tier === "SIMPLE") return "fast";
  if (tier === "MEDIUM") return "balanced";
  return "strong";
}

/**
 * Pick a model slot for the request.
 *
 * Profile semantics (see docs/routing-strategy.md):
 *   - auto     → tier → slot (14-dim score decides; SIMPLE→fast, MEDIUM→balanced, COMPLEX/REASONING→strong)
 *   - eco      → balanced (flash) regardless of tier — cost-optimized
 *   - premium  → strong (glm) regardless of tier — quality-optimized
 *
 * Vision requests always go to the vision slot regardless of profile — vision
 * is a capability requirement, not a difficulty signal.
 *
 * When DB provider channels exist for a slot, only slots that have at least one
 * healthy channel compatible with the request `protocol` (and requirements) are
 * considered. This allows mixed openai-compatible + anthropic channels across
 * slots without cross-protocol routing errors.
 */
export async function pickSlotForFeatures(
  slots: ModelSlots,
  input: {
    tier: Tier;
    profile?: "auto" | "eco" | "premium";
    requirements: {
      vision: boolean;
      toolCalling: boolean;
      agentic: boolean;
    };
    protocol?: 'openai-chat' | 'anthropic-messages';
  },
): Promise<ModelSlot> {
  // Vision is a capability requirement — always the vision slot first.
  if (input.requirements.vision) {
    const visionSlot = slots.vision;
    if (!visionSlot) {
      throw new Error("No configured vision slot can satisfy the request");
    }
    // Protocol gate on env declaration
    if (input.protocol === 'openai-chat' && visionSlot.provider === 'anthropic') {
      throw new Error("No configured vision slot can satisfy the request");
    }
    if (input.protocol === 'anthropic-messages' && visionSlot.provider === 'openai-compatible') {
      throw new Error("No configured vision slot can satisfy the request");
    }
    // If DB has channels for vision, at least one must be viable for this protocol
    const dbChans: ProviderChannel[] = await (async () => {
      try {
        return await listProviderInstances("vision");
      } catch {
        return [];
      }
    })();
    if (dbChans.length > 0) {
      if (!hasViableChannelFor(dbChans, input.protocol, input.requirements)) {
        throw new Error("No configured vision slot can satisfy the request");
      }
    }
    return visionSlot;
  }

  // Profile-driven slot selection (eco/premium override tier).
  const profileDefault: ModelSlotName | undefined =
    input.profile === "eco" ? "balanced" : input.profile === "premium" ? "strong" : undefined;

  const preferred: ModelSlotName[] = [];
  if (profileDefault) preferred.push(profileDefault);
  preferred.push(tierSlot(input.tier), "balanced", "strong");

  for (const slot of preferred) {
    const candidate = slots[slot];
    if (!candidate) continue;
    if (input.requirements.toolCalling && !candidate.supportsTools) continue;
    if (input.protocol === 'openai-chat' && candidate.provider === 'anthropic') continue;
    if (input.protocol === 'anthropic-messages' && candidate.provider === 'openai-compatible') continue;
    // "auto" is compatible with the incoming protocol.
    // This fix ensures Anthropic Messages requests never land on openai-compatible
    // slots (and the other way around).

    // When DB channels are registered for this slot, require at least one
    // that matches protocol + basic requirements. This makes mixed-protocol
    // setups (different providerKind per channel) work reliably.
    const dbChans: ProviderChannel[] = await (async () => {
      try {
        return await listProviderInstances(slot);
      } catch {
        return [];
      }
    })();
    if (dbChans.length > 0) {
      if (!hasViableChannelFor(dbChans, input.protocol, input.requirements)) {
        continue;
      }
    }
    return candidate;
  }

  throw new Error("No configured model slot can satisfy the request");
}
