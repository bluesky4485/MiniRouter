/* eslint-disable @typescript-eslint/no-explicit-any -- untyped provider request payloads are passed through unchanged. */

import type { Context } from "hono";
import type { AuthResult } from "../../auth/types.js";
import { route, getConfig } from "../../router/index.js";
import type { ModelPricing } from "../../router/selector.js";
import { logUsage } from "../../db/queries/usage.js";
import { randomUUID } from "node:crypto";
import { normalizeAnthropicMessagesRequest } from "../../protocols/anthropic-messages.js";
import { extractRoutingFeatures, type RoutingFeatures } from "../../routing/features/extractor.js";
import { getSlotForRoutingModel, loadEffectiveModelSlots, pickSlotForFeatures } from "../../providers/env.js";
import { executeAnthropicMessages } from "../../providers/anthropic.js";
import type { ModelSlot } from "../../providers/types.js";
import { optimizeWithHeadroom } from "../../context/headroom.js";
import { parseAnthropicUsage, toMutableUpstreamResponse } from "./chat.js";
import { extractPromptDigest, extractLastUserText } from "../../routing/features/prompt-digest.js";
import { extractSessionId } from "../session-id.js";
import { createSseUsageTap } from "../sse-usage-tap.js";
import { estimateUsdCostForModel } from "../../router/cost.js";
import { isSpendLimitExceeded } from "../../db/queries/spend.js";
import { executeWithChannelFallback } from "./channel-execution.js";

type EnvLike = Record<string, string | undefined>;
type RoutedTier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";

type SlotConfig = { slot: ModelSlot; tier: RoutedTier; profile: "auto" | "eco" | "premium"; effort?: string; debug: unknown; features: RoutingFeatures };
type OptimizationLog = {
  reason?: string;
  compression?: {
    originalChars: number;
    compressedChars: number;
    blocks: number;
  };
};

const routingModelPricing = new Map<string, ModelPricing>();

/**
 * Extract client-declared thinking effort from request body.
 * Anthropic: body.output_config.effort.
 * Official 5 levels: low | medium | high | xhigh | max.
 * Returns undefined when absent �� effort is passed through to the upstream
 * and does NOT participate in model selection. See docs/routing-strategy.md.
 */
function readEffort(body: any): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  const e = body?.output_config?.effort;
  return e === "low" || e === "medium" || e === "high" || e === "xhigh" || e === "max"
    ? e
    : undefined;
}

/**
 * Derive routing profile from the requested model name.
 * minirouter/eco �� eco (all flash), minirouter/premium �� premium (all glm),
 * otherwise auto (14-dim score decides). See docs/routing-strategy.md.
 */
function routingProfileFromModel(model: string): "auto" | "eco" | "premium" {
  const normalized = model.toLowerCase();
  if (normalized === "minirouter/eco" || normalized === "eco") return "eco";
  if (normalized === "minirouter/premium" || normalized === "premium") return "premium";
  return "auto";
}

function promptParts(request: ReturnType<typeof normalizeAnthropicMessagesRequest>): { prompt: string; systemPrompt?: string; classifierText?: string } {
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
  // ������ֻ����ǰ user turn �� ���򳤻Ựÿ�ֶ��������йؼ���,
  // ��Զ·�ɵ� REASONING��prompt ���������Ի���ʷ�� token ���㡣
  const classifierText = extractLastUserText(request.messages) ?? undefined;
  return { prompt, systemPrompt: systemPrompt || undefined, classifierText };
}

export async function selectConfiguredSlotForAnthropicMessages(
  body: any,
  env: EnvLike = process.env,
  options?: { discoverFromDb?: boolean },
): Promise<SlotConfig | null> {
  const slots = await loadEffectiveModelSlots(env, options);
  if (Object.keys(slots).length === 0) return null;

  const request = normalizeAnthropicMessagesRequest(body);
  const features = extractRoutingFeatures(request);
  const { prompt, systemPrompt, classifierText } = promptParts(request);
  const effort = readEffort(body);
  const modelParam = typeof body.model === "string" ? body.model : "minirouter/auto";
  const profile = routingProfileFromModel(modelParam);
  const decision = route(prompt, systemPrompt, request.maxOutputTokens, {
    config: getConfig(),
    modelPricing: routingModelPricing,
    routingProfile: profile,
    hasTools: features.requirements.toolCalling,
    effort,
  }, classifierText);
  const explicitSlot = getSlotForRoutingModel(slots, modelParam);

  if (explicitSlot) {
    if (!features.requirements.vision && features.requirements.toolCalling && !explicitSlot.supportsTools) {
      throw new Error("Explicit slot does not support tools");
    }
    return {
      tier: decision.tier,
      profile,
      effort,
      slot: explicitSlot,
      debug: decision.debug ?? null,
      features,
    };
  }

  return {
    tier: decision.tier,
    profile,
    effort,
    slot: await pickSlotForFeatures(slots, {
      tier: decision.tier,
      profile,
      requirements: {
        vision: features.requirements.vision,
        toolCalling: features.requirements.toolCalling,
        agentic: features.requirements.agentic,
      },
      protocol: 'anthropic-messages',
    }),
    debug: decision.debug ?? null,
    features,
  };
}

export function createUnsatisfiedAnthropicSlotResponse(): Response {
  return Response.json(
    {
      error: {
        message:
          "No configured MiniRouter model slot can satisfy this Anthropic Messages request. SUPPORTS_TOOLS for tool calls.",
        type: "configuration_error",
      },
    },
    { status: 503 },
  );
}

export function createAnthropicProviderErrorResponse(): Response {
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
          "MiniRouter has no configured model slots. Configure MINIROUTER_BALANCED_BASE_URL, MINIROUTER_STRONG_BASE_URL before using routed models.",
        type: "configuration_error",
      },
    },
    { status: 503 },
  );
}

async function executeConfiguredAnthropicBody(
  body: Record<string, unknown>,
  slot: ModelSlot,
): Promise<{ upstream: Response; optimization: OptimizationLog }> {
  if (slot.provider === "openai-compatible") {
    // Prevents Anthropic protocol requests from being sent to OpenAI-compatible
    // providers/channels (the root cause of many "request error" symptoms).
    return {
      upstream: Response.json(
        {
          error: {
            message:
              "This slot is configured for OpenAI-compatible. Use POST /v1/chat/completions instead of /v1/messages.",
            type: "protocol_mismatch",
          },
        },
        { status: 400 },
      ),
      optimization: {},
    };
  }

  const optimized = await optimizeWithHeadroom({
    protocol: "anthropic-messages",
    body,
    slot,
  });
  return {
    upstream: await executeAnthropicMessages(optimized.body, slot),
    optimization: {
      reason: optimized.applied ? optimized.reason : undefined,
      compression: optimized.compression,
    },
  };
}

async function rejectIfSpendLimitExceeded(c: Context, auth: AuthResult): Promise<Response | undefined> {
  const result = await isSpendLimitExceeded({
    userId: auth.userId,
    apiKeyId: auth.apiKeyId,
    dailyLimitUsd: auth.spendLimitDailyUsd,
    monthlyLimitUsd: auth.spendLimitMonthlyUsd,
    keyDailyLimitUsd: auth.keySpendLimitDailyOverrideUsd,
  });
  if (!result.exceeded) return undefined;
  return c.json(
    {
      error: {
        message: `Spend limit exceeded (${result.scope}): ${result.currentUsd?.toFixed(4)} >= ${result.limitUsd?.toFixed(4)} USD`,
        type: "spend_limit_exceeded",
      },
    },
    402,
  );
}

function usageOptimizationFields(optimization: OptimizationLog | undefined | null) {
  const o = optimization || {};
  return {
    optimizationReason: o.reason,
    compressionApplied: o.compression !== undefined,
    compressionOriginalChars: o.compression?.originalChars,
    compressionCompressedChars: o.compression?.compressedChars,
    compressionBlocks: o.compression?.blocks,
  };
}

export async function anthropicMessages(c: Context) {
  const auth = c.get("auth") as AuthResult;
  const body = await c.req.json();
  const requestId = randomUUID();
  const modelParam = typeof body.model === "string" ? body.model : "minirouter/auto";
  const spendLimitResponse = await rejectIfSpendLimitExceeded(c, auth);
  if (spendLimitResponse) return spendLimitResponse;
  const normalized = normalizeAnthropicMessagesRequest(body);
  const promptDigest = extractPromptDigest(normalized.messages);
  const sessionId = extractSessionId(c, normalized.messages, auth.userId);
  let configured: SlotConfig | null;
  try {
    configured = await selectConfiguredSlotForAnthropicMessages(body);
  } catch (error) {
    console.error("[MiniRouter] slot selection failed:", (error as Error).message);
    return createUnsatisfiedAnthropicSlotResponse();
  }

  if (!configured) return createMissingAnthropicSlotResponse();

  let upstream: Response;
  let optimization: OptimizationLog = {};
  try {
    const result = await executeWithChannelFallback({
      slot: configured.slot.slot,
      requirements: {
        toolCalling: configured.features.requirements.toolCalling,
        vision: configured.features.requirements.vision,
      },
      executor: (slot) => executeConfiguredAnthropicBody(body, slot),
      protocol: 'anthropic-messages',
      sessionId,
    });
    upstream = result.upstream;
    optimization = result.optimization;
    configured.slot = result.slot;
  } catch {
    return createAnthropicProviderErrorResponse();
  }

  // For non-streaming responses, try to parse usage from the upstream JSON.
  // For streaming responses, tap the SSE stream to capture usage from
  // message_start/message_delta events, then logUsage after the stream ends.
  const isStreaming = body.stream === true;
  const startedAt = Date.now();
  let inputTokens = configured.features.estimatedInputTokens;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  if (isStreaming && upstream.ok && upstream.body) {
    const { passthrough, finalUsage } = createSseUsageTap(upstream.body, "anthropic");
    // ��ʽ:���� passthrough ���ͻ���,���������첽д logUsage
    const response = new Response(passthrough, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: new Headers(upstream.headers),
    });
    // ��������Ӧ �� ����������д usage log
    finalUsage
      .then(async (u) => {
        try {
          const cost = await estimateUsdCostForModel(configured.slot.pricingModelId ?? configured.slot.model, {
            inputTokens: u.inputTokens ?? inputTokens,
            outputTokens: u.outputTokens ?? 0,
            cacheReadTokens: u.cacheReadTokens ?? 0,
          });
          logUsage({
            userId: auth.userId,
            apiKeyId: auth.apiKeyId,
            providerInstanceId: configured.slot.providerInstanceId,
            requestId,
            requestedModel: modelParam,
            selectedSlot: configured.slot.slot,
            model: configured.slot.model,
            tier: configured.tier,
            profile: configured.profile,
            strategy: "env-slot-native-anthropic",
            effort: configured.effort,
            routingDebug: configured.debug ? JSON.stringify(configured.debug) : undefined,
            inputTokens: u.inputTokens ?? inputTokens,
            outputTokens: u.outputTokens ?? 0,
            cacheReadTokens: u.cacheReadTokens ?? 0,
            costUsd: cost.costUsd,
            latencyMs: Date.now() - startedAt,
            status: "success",
            hasTools: configured.features.requirements.toolCalling,
            isStreaming,
            hasVision: configured.features.requirements.vision,
            hasAgentic: configured.features.requirements.agentic,
            promptDigest: promptDigest ?? undefined,
            ...usageOptimizationFields(optimization),
          }).catch((err) => {
            console.error("[MiniRouter] Failed to write stream usage log:", (err as Error).message);
          });
        } catch (err) {
          console.error("[MiniRouter] stream usage log error:", (err as Error).message);
        }
      })
      .catch(() => {
        // �����ͻ����жϵ�,��д log
      });
    return response;
  }

  if (!isStreaming && upstream.ok) {
    const usage = await parseAnthropicUsage(upstream);
    if (usage) {
      inputTokens = usage.promptTokens;
      outputTokens = usage.completionTokens;
      cacheReadTokens = usage.cacheReadTokens;
    }
  }
  const cost = await estimateUsdCostForModel(configured.slot.pricingModelId ?? configured.slot.model, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
  });

  try {
    await logUsage({
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      providerInstanceId: configured.slot.providerInstanceId,
      requestId,
      requestedModel: modelParam,
      selectedSlot: configured.slot.slot,
      model: configured.slot.model,
      tier: configured.tier,
      profile: configured.profile,
      strategy: "env-slot-native-anthropic",
      effort: configured.effort,
      routingDebug: configured.debug ? JSON.stringify(configured.debug) : undefined,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: cost.costUsd,
      latencyMs: Date.now() - startedAt,
      status: upstream.ok ? "success" : "error",
      errorType: upstream.ok ? undefined : `http_${upstream.status}`,
      hasTools: configured.features.requirements.toolCalling,
      isStreaming,
      hasVision: configured.features.requirements.vision,
      hasAgentic: configured.features.requirements.agentic,
      promptDigest: promptDigest ?? undefined,
      ...usageOptimizationFields(optimization),
    });
  } catch (err) {
    console.error("[MiniRouter] Failed to write usage log:", (err as Error).message);
  }

  return toMutableUpstreamResponse(upstream);
}
