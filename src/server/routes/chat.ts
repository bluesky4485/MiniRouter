/**
 * OpenAI-compatible chat completions route.
 *
 * MiniRouter preserves the incoming API standard. This route only serves
 * OpenAI Chat-compatible requests and forwards them to OpenAI-compatible
 * upstream providers. Native Anthropic requests use /v1/messages.
 */

import type { Context } from "hono";
import type { AuthResult } from "../../auth/types.js";
import { route, DEFAULT_ROUTING_CONFIG } from "../../router/index.js";
import { buildModelPricing } from "../../router/utils.js";
import { logUsage } from "../../db/queries/usage.js";
import { randomUUID } from "node:crypto";
import { normalizeOpenAIChatRequest } from "../../protocols/openai-chat.js";
import { extractRoutingFeatures } from "../../routing/features/extractor.js";
import { getSlotForRoutingModel, loadModelSlotsFromEnv, pickSlotForFeatures } from "../../providers/env.js";
import type { ModelSlot } from "../../providers/types.js";
import { executeOpenAICompatibleChat } from "../../providers/openai-compatible.js";
import { optimizeWithHeadroom } from "../../context/headroom.js";
import { extractPromptDigest } from "../../routing/features/prompt-digest.js";

type EnvLike = Record<string, string | undefined>;
type RoutedTier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";

function getPromptParts(body: any): { prompt: string; systemPrompt?: string } {
  const request = normalizeOpenAIChatRequest(body);
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

export function slotCanServeOpenAIChat(slot: ModelSlot): boolean {
  return slot.provider !== "anthropic";
}

export function selectConfiguredSlotForChat(
  body: any,
  env: EnvLike = process.env,
): { slot: ModelSlot; tier: RoutedTier } | null {
  const slots = loadModelSlotsFromEnv(env);
  if (Object.keys(slots).length === 0) return null;

  const request = normalizeOpenAIChatRequest(body);
  const features = extractRoutingFeatures(request);
  const { prompt, systemPrompt } = getPromptParts(body);
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
  };
}

async function executeConfiguredSlot(body: any, slot: ModelSlot): Promise<Response> {
  if (!slotCanServeOpenAIChat(slot)) {
    return Response.json(
      {
        error: {
          message:
            "This slot is configured for native Anthropic Messages. Use POST /v1/messages instead of /v1/chat/completions.",
          type: "protocol_mismatch",
        },
      },
      { status: 400 },
    );
  }

  const optimized = await optimizeWithHeadroom({
    protocol: "openai-chat",
    body,
    slot,
  });
  return executeOpenAICompatibleChat(optimized.body, slot);
}

export function createMissingSlotResponse(): Response {
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

export function createUnsatisfiedSlotResponse(_error: unknown): Response {
  return Response.json(
    {
      error: {
        message:
          "No configured MiniRouter model slot can satisfy this request. Check VISION support for image inputs and SUPPORTS_TOOLS for Agent/tool calls.",
        type: "configuration_error",
      },
    },
    { status: 503 },
  );
}

export function createProviderErrorResponse(_error: unknown): Response {
  return Response.json(
    {
      error: {
        message:
          "Upstream provider request failed. Check the selected slot BASE_URL, API_KEY, and network access.",
        type: "provider_error",
      },
    },
    { status: 502 },
  );
}

export function toMutableUpstreamResponse(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: new Headers(upstream.headers),
  });
}

/**
 * Parse OpenAI-compatible usage from a non-streaming upstream response.
 * Returns { promptTokens, completionTokens, cacheReadTokens } or undefined
 * if parsing fails.
 */
export async function parseOpenAIUsage(upstream: Response): Promise<{ promptTokens: number; completionTokens: number; cacheReadTokens: number } | undefined> {
  try {
    const cloned = upstream.clone();
    const text = await cloned.text();
    const json = JSON.parse(text);
    const usage = json?.usage;
    if (!usage) return undefined;
    return {
      promptTokens: Number(usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? 0),
      cacheReadTokens: Number(usage.cache_read_tokens ?? usage.prompt_tokens_details?.caching?.credits ?? 0),
    };
  } catch {
    return undefined;
  }
}

/**
 * Parse Anthropic usage from a non-streaming upstream response.
 */
export async function parseAnthropicUsage(upstream: Response): Promise<{ promptTokens: number; completionTokens: number; cacheReadTokens: number } | undefined> {
  try {
    const cloned = upstream.clone();
    const text = await cloned.text();
    const json = JSON.parse(text);
    const usage = json?.usage;
    if (!usage) return undefined;
    return {
      promptTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
      cacheReadTokens: Number(usage.cache_creation_input_tokens ?? usage.cache_read_input_tokens ?? 0),
    };
  } catch {
    return undefined;
  }
}

function isRoutingModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized === "minirouter/auto" ||
    normalized === "minirouter/eco" ||
    normalized === "minirouter/premium" ||
    normalized === "auto" ||
    normalized === "eco" ||
    normalized === "premium" ||
    /^minirouter\/slot\/(fast|balanced|strong|vision)$/.test(normalized)
  );
}

function routingProfile(model: string, headerProfile: string | undefined): "eco" | "auto" | "premium" | undefined {
  const normalized = model.toLowerCase();
  if (normalized === "minirouter/eco" || normalized === "eco") return "eco";
  if (normalized === "minirouter/premium" || normalized === "premium") return "premium";
  if (headerProfile === "eco" || headerProfile === "premium") return headerProfile;
  return undefined;
}

export async function chatCompletions(c: Context) {
  const auth = c.get("auth") as AuthResult;
  const body = await c.req.json();
  const requestId = randomUUID();
  const modelParam: string = body.model ?? "minirouter/auto";

  if (!isRoutingModel(modelParam)) {
    return c.json(
      {
        error: {
          message:
            "Direct model passthrough is not configured in the env-slot MVP. Use model=minirouter/auto, minirouter/eco, or minirouter/premium.",
          type: "unsupported_direct_model",
        },
      },
      400,
    );
  }

  let configured: { slot: ModelSlot; tier: RoutedTier } | null;
  try {
    configured = selectConfiguredSlotForChat(body);
  } catch (error) {
    return createUnsatisfiedSlotResponse(error);
  }
  if (!configured) return createMissingSlotResponse();

  const request = normalizeOpenAIChatRequest(body);
  const features = extractRoutingFeatures(request);
  let upstream: Response;
  try {
    upstream = await executeConfiguredSlot(body, configured.slot);
  } catch (error) {
    return createProviderErrorResponse(error);
  }

  // For non-streaming responses, try to parse usage from the upstream JSON.
  // Streaming responses still log estimated input tokens only.
  const isStreaming = body.stream === true;
  let inputTokens = features.estimatedInputTokens;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  if (!isStreaming && upstream.ok) {
    const usage = await parseOpenAIUsage(upstream);
    if (usage) {
      inputTokens = usage.promptTokens;
      outputTokens = usage.completionTokens;
      cacheReadTokens = usage.cacheReadTokens;
    }
  }

  try {
    await logUsage({
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      requestId,
      model: configured.slot.model,
      tier: configured.tier,
      profile: routingProfile(modelParam, c.req.header("x-routing-profile")),
      strategy: "env-slot-native-openai-chat",
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: 0,
      status: upstream.ok ? "success" : "error",
      hasTools: features.requirements.toolCalling,
      isStreaming,
      hasVision: features.requirements.vision,
      promptDigest: extractPromptDigest(request.messages) ?? undefined,
    });
  } catch (err) {
    console.error("[MiniRouter] Failed to write usage log:", (err as Error).message);
  }

  return toMutableUpstreamResponse(upstream);
}
