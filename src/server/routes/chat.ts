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
import { extractPromptDigest, extractLastUserText } from "../../routing/features/prompt-digest.js";
import { createSseUsageTap } from "../sse-usage-tap.js";
import { materializeLocalMediaReferencesWithDiagnostics } from "../../providers/client-adapter.js";

type EnvLike = Record<string, string | undefined>;
type RoutedTier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";
type OptimizationLog = {
  reason?: string;
  compression?: {
    originalChars: number;
    compressedChars: number;
    blocks: number;
  };
};

/**
 * Extract client-declared thinking effort from request body.
 * OpenAI: body.reasoning_effort; also accept body.output_config.effort.
 * Official 5 levels: low | medium | high | xhigh | max.
 * Returns undefined when absent — router falls back to 14-dim score.
 */
function readEffort(body: any): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  const e = body?.output_config?.effort ?? body?.reasoning_effort;
  return e === "low" || e === "medium" || e === "high" || e === "xhigh" || e === "max"
    ? e
    : undefined;
}

function getPromptParts(body: any): { prompt: string; systemPrompt?: string; classifierText?: string } {
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
  // 分类器只看当前 user turn — 避免长会话每轮都命中所有关键词
  // 导致永远路由到 REASONING。prompt 仍用完整对话历史做 token 估算。
  const classifierText = extractLastUserText(request.messages) ?? undefined;
  return { prompt, systemPrompt: systemPrompt || undefined, classifierText };
}

export function slotCanServeOpenAIChat(slot: ModelSlot): boolean {
  return slot.provider !== "anthropic";
}

export function selectConfiguredSlotForChat(
  body: any,
  env: EnvLike = process.env,
): { slot: ModelSlot; tier: RoutedTier; profile: "auto" | "eco" | "premium" | undefined; effort?: string; debug: unknown } | null {
  const slots = loadModelSlotsFromEnv(env);
  if (Object.keys(slots).length === 0) return null;

  const request = normalizeOpenAIChatRequest(body);
  const features = extractRoutingFeatures(request);
  const { prompt, systemPrompt, classifierText } = getPromptParts(body);
  const effort = readEffort(body);
  const modelParam: string = body.model ?? "minirouter/auto";
  const profile = routingProfile(modelParam, undefined);
  const decision = route(prompt, systemPrompt, request.maxOutputTokens, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing: buildModelPricing(),
    routingProfile: profile,
    hasTools: features.requirements.toolCalling,
    effort,
  }, classifierText);
  const explicitSlot = getSlotForRoutingModel(slots, modelParam);

  if (explicitSlot) {
    if (features.requirements.toolCalling && !explicitSlot.supportsTools) {
      throw new Error("Explicit slot does not support tools");
    }
    return {
      tier: decision.tier,
      profile,
      effort,
      slot: explicitSlot,
      debug: decision.debug ?? null,
    };
  }

  return {
    tier: decision.tier,
    profile,
    effort,
    slot: pickSlotForFeatures(slots, {
      tier: decision.tier,
      profile,
      requirements: {
        vision: features.requirements.vision,
        toolCalling: features.requirements.toolCalling,
        agentic: features.requirements.agentic,
      },
    }),
    debug: decision.debug ?? null,
  };
}

async function executeConfiguredSlot(body: any, slot: ModelSlot): Promise<{ upstream: Response; optimization: OptimizationLog }> {
  if (!slotCanServeOpenAIChat(slot)) {
    return {
      upstream: Response.json(
      {
        error: {
          message:
            "This slot is configured for native Anthropic Messages. Use POST /v1/messages instead of /v1/chat/completions.",
          type: "protocol_mismatch",
        },
      },
      { status: 400 },
      ),
      optimization: {},
    };
  }

  const optimized = await optimizeWithHeadroom({
    protocol: "openai-chat",
    body,
    slot,
  });
  return {
    upstream: await executeOpenAICompatibleChat(optimized.body, slot),
    optimization: {
      reason: optimized.applied ? optimized.reason : undefined,
      compression: optimized.compression,
    },
  };
}

function usageOptimizationFields(optimization: OptimizationLog) {
  return {
    optimizationReason: optimization.reason,
    compressionApplied: optimization.compression !== undefined,
    compressionOriginalChars: optimization.compression?.originalChars,
    compressionCompressedChars: optimization.compression?.compressedChars,
    compressionBlocks: optimization.compression?.blocks,
  };
}

export function createMissingSlotResponse(): Response {
  return Response.json(
    {
      error: {
        message:
          "MiniRouter has no configured model slots. Configure MINIROUTER_BALANCED_BASE_URL or MINIROUTER_STRONG_BASE_URL before using routed models.",
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
          "No configured MiniRouter model slot can satisfy this request. Check SUPPORTS_TOOLS for Agent/tool calls.",
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
      cacheReadTokens: Number(
        usage.cache_read_tokens ??
        usage.cached_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        usage.prompt_tokens_details?.caching?.credits ??
        0,
      ),
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
      cacheReadTokens: Number(
        usage.cache_read_input_tokens ??
        usage.cache_read_tokens ??
        usage.cached_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        usage.input_tokens_details?.cached_tokens ??
        usage.prompt_tokens_details?.caching?.credits ??
        0,
      ),
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
    /^minirouter\/slot\/(fast|balanced|strong)$/.test(normalized)
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
  const traceEnabled = process.env["MINIROUTER_TRACE_LOG"] === "true";
  const traceStart = Date.now();
  const trace = (stage: string) => {
    if (traceEnabled) console.error(`[MiniRouter trace] chat ${stage} +${Date.now() - traceStart}ms`);
  };
  trace("start");
  let body = await c.req.json();
  trace("json_parsed");
  const requestId = randomUUID();
  const localMedia = materializeLocalMediaReferencesWithDiagnostics(body, "openai-chat");
  body = localMedia.body;
  trace(`local_media:${localMedia.status}`);
  if (localMedia.status !== "no_path" && localMedia.status !== "no_text" && localMedia.status !== "no_messages") {
    console.error(
      `[MiniRouter] local media materialization status=${localMedia.status} path=${localMedia.filePath ?? "n/a"} bytes=${localMedia.bytes ?? "n/a"}`,
    );
  }
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

  let configured: { slot: ModelSlot; tier: RoutedTier; profile: "auto" | "eco" | "premium" | undefined; effort?: string; debug: unknown } | null;
  try {
    trace("select_slot_start");
    configured = selectConfiguredSlotForChat(body);
    trace(`select_slot_done:${configured?.slot.slot ?? "none"}`);
  } catch (error) {
    return createUnsatisfiedSlotResponse(error);
  }
  if (!configured) return createMissingSlotResponse();

  trace("normalize_start");
  const request = normalizeOpenAIChatRequest(body);
  trace("normalize_done");
  trace("features_start");
  const features = extractRoutingFeatures(request);
  trace("features_done");
  let upstream: Response;
  let optimization: OptimizationLog = {};
  try {
    trace("execute_slot_start");
    const result = await executeConfiguredSlot(body, configured.slot);
    trace(`execute_slot_done:${result.upstream.status}`);
    upstream = result.upstream;
    optimization = result.optimization;
  } catch (error) {
    trace(`execute_slot_error:${(error as Error).message}`);
    return createProviderErrorResponse(error);
  }

  // For non-streaming responses, try to parse usage from the upstream JSON.
  // For streaming responses, tap the SSE stream to capture usage, then log
  // after the stream ends.
  const isStreaming = body.stream === true;
  const startedAt = Date.now();
  let inputTokens = features.estimatedInputTokens;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  if (isStreaming && upstream.ok && upstream.body) {
    const { passthrough, finalUsage } = createSseUsageTap(upstream.body, "openai");
    const response = new Response(passthrough, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: new Headers(upstream.headers),
    });
    finalUsage
      .then((u) => {
        try {
          logUsage({
            userId: auth.userId,
            apiKeyId: auth.apiKeyId,
            requestId,
            model: configured.slot.model,
            tier: configured.tier,
            profile: configured.profile,
            strategy: "env-slot-native-openai-chat",
            effort: configured.effort,
            routingDebug: configured.debug ? JSON.stringify(configured.debug) : undefined,
            inputTokens: u.inputTokens ?? inputTokens,
            outputTokens: u.outputTokens ?? 0,
            cacheReadTokens: u.cacheReadTokens ?? 0,
            costUsd: 0,
            latencyMs: Date.now() - startedAt,
            status: "success",
            hasTools: features.requirements.toolCalling,
            isStreaming,
            hasVision: features.requirements.vision,
            promptDigest: extractPromptDigest(request.messages) ?? undefined,
            ...usageOptimizationFields(optimization),
          }).catch((err) => {
            console.error("[MiniRouter] Failed to write stream usage log:", (err as Error).message);
          });
        } catch (err) {
          console.error("[MiniRouter] stream usage log error:", (err as Error).message);
        }
      })
      .catch(() => {
        // 流被客户端中断,不写 log
      });
    return response;
  }

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
      profile: configured.profile,
      strategy: "env-slot-native-openai-chat",
      effort: configured.effort,
      routingDebug: configured.debug ? JSON.stringify(configured.debug) : undefined,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      status: upstream.ok ? "success" : "error",
      errorType: upstream.ok ? undefined : `http_${upstream.status}`,
      hasTools: features.requirements.toolCalling,
      isStreaming,
      hasVision: features.requirements.vision,
      promptDigest: extractPromptDigest(request.messages) ?? undefined,
      ...usageOptimizationFields(optimization),
    });
  } catch (err) {
    console.error("[MiniRouter] Failed to write usage log:", (err as Error).message);
  }

  return toMutableUpstreamResponse(upstream);
}
