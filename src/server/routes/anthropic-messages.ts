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
import { executeOpenAICompatibleChat } from "../../providers/openai-compatible.js";
import {
  adaptAnthropicMessagesToMiniCpmVisionOpenAI,
  adaptMiniCpmVisionOpenAIResponseToAnthropic,
} from "../../providers/client-adapter.js";
import type { ModelSlot } from "../../providers/types.js";
import { optimizeWithHeadroom } from "../../context/headroom.js";
import { parseAnthropicUsage, toMutableUpstreamResponse } from "./chat.js";
import { extractPromptDigest } from "../../routing/features/prompt-digest.js";

type EnvLike = Record<string, string | undefined>;
type RoutedTier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";

type SlotConfig = { slot: ModelSlot; tier: RoutedTier; features: RoutingFeatures };

/**
 * Extract client-declared thinking effort from request body.
 * Anthropic: body.output_config.effort.
 * Official 5 levels: low | medium | high | xhigh | max.
 * Returns undefined when absent — router falls back to 14-dim score.
 */
function readEffort(body: any): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  const e = body?.output_config?.effort;
  return e === "low" || e === "medium" || e === "high" || e === "xhigh" || e === "max"
    ? e
    : undefined;
}

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

// ─── Vision content detection / preprocessing ───────────────────────────────

function isVisionBlock(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false;
  const t = (part as Record<string, unknown>).type;
  return t === "image" || t === "video" || t === "image_url" || t === "video_url" || t === "input_image";
}

export function hasVisionContent(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((msg) => {
    if (typeof msg !== "object" || msg === null) return false;
    const content = (msg as Record<string, unknown>).content;
    return Array.isArray(content) && content.some(isVisionBlock);
  });
}

function stripImages(body: Record<string, unknown>, observation: string): Record<string, unknown> {
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;

  let observationInjected = false;
  const cleaned = messages.map((msg) => {
    if (typeof msg !== "object" || msg === null) return msg;
    const record = msg as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) return msg;

    const hasVision = content.some(isVisionBlock);
    if (!hasVision) return msg;

    const textBlocks = content.filter((part) => !isVisionBlock(part));
    if (!observationInjected) {
      observationInjected = true;
      textBlocks.push({
        type: "text",
        text: `[视觉分析结果]
以下是对用户分享图片的视觉观察（由视觉模块自动生成）：

${observation}

[说明] 以上为视觉模块的分析结果。请基于这些观察回答用户问题，并结合你的知识进行推理和整合。`,
      });
    }
    return { ...record, content: textBlocks };
  });

  return { ...body, messages: cleaned };
}

function stripImagesFallback(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;

  let fallbackInjected = false;
  const cleaned = messages.map((msg) => {
    if (typeof msg !== "object" || msg === null) return msg;
    const record = msg as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) return msg;

    const hasVision = content.some(isVisionBlock);
    if (!hasVision) return msg;

    const textBlocks = content.filter((part) => !isVisionBlock(part));
    if (!fallbackInjected) {
      fallbackInjected = true;
      textBlocks.push({
        type: "text",
        text: "[视觉分析失败]\n用户分享了一张图片/视频，但视觉预处理模块未能成功分析。以下为已知信息：\n- 图片/视频文件已接收，但视觉模型暂时不可用或分析超时。\n- 请基于用户问题中的文字信息和你的知识尽力回答。\n- 如果问题完全依赖视觉内容，请如实告知用户当前无法分析图片。",
      });
    }
    return { ...record, content: textBlocks };
  });

  return { ...body, messages: cleaned };
}

async function preprocessVision(
  body: Record<string, unknown>,
  visionSlot: ModelSlot,
): Promise<string | null> {
  try {
    const visionBody = adaptAnthropicMessagesToMiniCpmVisionOpenAI(body);
    const response = await executeOpenAICompatibleChat(visionBody, visionSlot);
    if (!response.ok) {
      console.error(`[MiniRouter] vision preprocessing upstream error: ${response.status}`);
      return null;
    }
    const json = await response.json() as Record<string, unknown>;
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const content = choices?.[0]?.message as Record<string, unknown> | undefined;
    const text = typeof content?.content === "string" ? content.content : "";
    return text || null;
  } catch (e) {
    console.error("[MiniRouter] vision preprocessing failed:", (e as Error).message);
    return null;
  }
}

// ─── Router helpers ──────────────────────────────────────────────────────────

export function selectConfiguredSlotForAnthropicMessages(
  body: any,
  env: EnvLike = process.env,
): SlotConfig | null {
  const slots = loadModelSlotsFromEnv(env);
  if (Object.keys(slots).length === 0) return null;

  const request = normalizeAnthropicMessagesRequest(body);
  const features = extractRoutingFeatures(request);
  const { prompt, systemPrompt } = promptParts(request);
  const effort = readEffort(body);
  const decision = route(prompt, systemPrompt, request.maxOutputTokens, {
    config: DEFAULT_ROUTING_CONFIG,
    modelPricing: buildModelPricing(),
    routingProfile: undefined,
    hasTools: features.requirements.toolCalling,
    effort,
  });
  const explicitSlot = typeof body.model === "string" ? getSlotForRoutingModel(slots, body.model) : undefined;

  if (explicitSlot) {
    if (features.requirements.vision && !explicitSlot.supportsVision) {
      throw new Error("Explicit slot does not support vision");
    }
    if (!features.requirements.vision && features.requirements.toolCalling && !explicitSlot.supportsTools) {
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

async function executeConfiguredAnthropicBody(body: Record<string, unknown>, slot: ModelSlot): Promise<Response> {
  if (slot.provider === "openai-compatible") {
    const openAiBody = adaptAnthropicMessagesToMiniCpmVisionOpenAI(body);
    const optimized = await optimizeWithHeadroom({
      protocol: "openai-chat",
      body: openAiBody,
      slot,
    });
    const upstream = await executeOpenAICompatibleChat(optimized.body, slot);
    return adaptMiniCpmVisionOpenAIResponseToAnthropic(upstream, {
      model: slot.model,
      stream: body["stream"] === true,
    });
  }

  const optimized = await optimizeWithHeadroom({
    protocol: "anthropic-messages",
    body,
    slot,
  });
  return executeAnthropicMessages(optimized.body, slot);
}

export async function anthropicMessages(c: Context) {
  const auth = c.get("auth") as AuthResult;
  let body = await c.req.json();
  const requestId = randomUUID();

  // ─── Vision preprocessing ──────────────────────────────────────────
  // auto mode: strip images, call MiniCPM-V, inject observation,
  // then route to balanced/strong as normal.
  // Explicit minirouter/slot/vision: keep images intact, route directly
  // to the vision slot for debugging/probing.
  const isExplicitVisionSlot = typeof body.model === "string"
    && body.model.toLowerCase().startsWith("minirouter/slot/vision");
  const hadVision = hasVisionContent(body.messages);
  if (hadVision && !isExplicitVisionSlot) {
    const slots = loadModelSlotsFromEnv();
    if (slots.vision) {
      const observation = await preprocessVision(body, slots.vision);
      if (observation) {
        body = stripImages(body, observation);
        console.error(`[MiniRouter] vision preprocessed, observation=${observation.length} chars`);
      } else {
        body = stripImagesFallback(body);
      }
    } else {
      console.error("[MiniRouter] vision detected but no vision slot configured");
      body = stripImagesFallback(body);
    }
  }

  const normalized = normalizeAnthropicMessagesRequest(body);
  const promptDigest = extractPromptDigest(normalized.messages);
  let configured: SlotConfig | null;
  try {
    configured = selectConfiguredSlotForAnthropicMessages(body);
  } catch (error) {
    console.error("[MiniRouter] slot selection failed:", (error as Error).message);
    return createUnsatisfiedAnthropicSlotResponse(error);
  }

  if (!configured) return createMissingAnthropicSlotResponse();

  let upstream: Response;
  try {
    upstream = await executeConfiguredAnthropicBody(body, configured.slot);
  } catch (error) {
    console.error("[MiniRouter] upstream request failed:", (error as Error).message);
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
      promptDigest: promptDigest ?? undefined,
    });
  } catch (err) {
    console.error("[MiniRouter] Failed to write usage log:", (err as Error).message);
  }

  return toMutableUpstreamResponse(upstream);
}
