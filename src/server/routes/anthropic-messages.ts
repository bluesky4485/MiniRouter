import type { Context } from "hono";
import type { AuthResult } from "../../auth/types.js";
import { route, DEFAULT_ROUTING_CONFIG } from "../../router/index.js";
import { buildModelPricing } from "../../router/utils.js";
import { logUsage } from "../../db/queries/usage.js";
import { randomUUID } from "node:crypto";
import { normalizeAnthropicMessagesRequest } from "../../protocols/anthropic-messages.js";
import { extractRoutingFeatures, type RoutingFeatures } from "../../routing/features/extractor.js";
import { getSlotForRoutingModel, loadModelSlotsFromEnv, pickSlotForFeatures } from "../../providers/env.js";
import { executeAnthropicMessages } from "../../providers/anthropic.js";
import type { ModelSlot } from "../../providers/types.js";
import { optimizeWithHeadroom } from "../../context/headroom.js";
import { parseAnthropicUsage, toMutableUpstreamResponse } from "./chat.js";

type EnvLike = Record<string, string | undefined>;
type RoutedTier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";

type SlotConfig = { slot: ModelSlot; tier: RoutedTier; features: RoutingFeatures };

function promptParts(request: ReturnType<typeof normalizeAnthropicMessagesRequest>): { prompt: string; systemPrompt?: string } {
  const prompt = request.messages
    .filter((message) => message.role !== "system")
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const systemPrompt = request.messages
    .filter((message) => message.role === "system")
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return { prompt, systemPrompt: systemPrompt || undefined };
}

export function selectConfiguredSlotForAnthropicMessages(
  body: any,
  env: EnvLike = process.env,
): SlotConfig | null {
  const slots = loadModelSlotsFromEnv(env);
  if (Object.keys(slots).length === 0) return null;

  const request = normalizeAnthropicMessagesRequest(body);
  const features = extractRoutingFeatures(request);
  const { prompt, systemPrompt } = promptParts(request);
  const decision = route(prompt, systemPrompt, request.maxOutputTokens, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing: buildModelPricing(),
    routingProfile: undefined,
    hasTools: features.requirements.toolCalling,
  });
  const explicitSlot = typeof body.model === "string" ? getSlotForRoutingModel(slots, body.model) : undefined;

  if (explicitSlot) {
    if (features.requirements.vision && !explicitSlot.supportsVision) {
      throw new Error("Explicit slot does not support vision");
    }
    if (features.requirements.toolCalling && !explicitSlot.supportsTools) {
      throw new Error("Explicit slot does not support tools");
    }
    return {
      tier: decision.tier,
      slot: explicitSlot,
      features,
    };
  }

  return {
    tier: decision.tier,
    slot: pickSlotForFeatures(slots, {
      tier: decision.tier,
      requirements: {
        vision: features.requirements.vision,
        toolCalling: features.requirements.toolCalling,
        agentic: features.requirements.agentic,
      },
    }),
    features,
  };
}

export function createUnsatisfiedAnthropicSlotResponse(_error: unknown): Response {
  return Response.json(
    {
      error: {
        message:
          "No configured MiniRouter model slot can satisfy this Anthropic Messages request. Check VISION support for image inputs and SUPPORTS_TOOLS for tool calls.",
        type: "configuration_error",
      },
    },
    { status: 503 },
  );
}

export function createAnthropicProviderErrorResponse(_error: unknown): Response {
  return Response.json(
    {
      error: {
        message:
          "Upstream Anthropic Messages provider request failed. Check the selected slot BASE_URL, API_KEY, and network access.",
        type: "provider_error",
      },
    },
    { status: 502 },
  );
}

export function createMissingAnthropicSlotResponse(): Response {
  return Response.json(
    {
      error: {
        message:
          "MiniRouter has no configured model slots. Configure MINIROUTER_BALANCED_BASE_URL, MINIROUTER_STRONG_BASE_URL, or MINIROUTER_VISION_BASE_URL before using routed models.",
        type: "configuration_error",
      },
    },
    { status: 503 },
  );
}

export async function anthropicMessages(c: Context) {
  const auth = c.get("auth") as AuthResult;
  const body = await c.req.json();
  const requestId = randomUUID();
  let configured: SlotConfig | null;
  try {
    configured = selectConfiguredSlotForAnthropicMessages(body);
  } catch (error) {
    return createUnsatisfiedAnthropicSlotResponse(error);
  }

  if (!configured) return createMissingAnthropicSlotResponse();

  const optimized = await optimizeWithHeadroom({
    protocol: "anthropic-messages",
    body,
    slot: configured.slot,
  });
  let upstream: Response;
  try {
    upstream = await executeAnthropicMessages(optimized.body, configured.slot);
  } catch (error) {
    return createAnthropicProviderErrorResponse(error);
  }

  // For non-streaming responses, try to parse usage from the upstream JSON.
  const isStreaming = body.stream === true;
  let inputTokens = configured.features.estimatedInputTokens;
  let outputTokens = 0;

  if (!isStreaming && upstream.ok) {
    const usage = await parseAnthropicUsage(upstream);
    if (usage) {
      inputTokens = usage.promptTokens;
      outputTokens = usage.completionTokens;
    }
  }

  try {
    await logUsage({
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      requestId,
      model: configured.slot.model,
      tier: configured.tier,
      strategy: "env-slot-native-anthropic",
      inputTokens,
      outputTokens,
      costUsd: 0,
      status: upstream.ok ? "success" : "error",
      hasTools: configured.features.requirements.toolCalling,
      isStreaming,
      hasVision: configured.features.requirements.vision,
    });
  } catch (err) {
    console.error("[MiniRouter] Failed to write usage log:", (err as Error).message);
  }

  return toMutableUpstreamResponse(upstream);
}