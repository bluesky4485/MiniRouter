/**
 * Headroom context optimization.
 *
 * Adaptive mode is intentionally tail-only:
 * - scan for oversized tool output / tool_result tail blocks
 * - send only those blocks to Headroom
 * - merge compressed tails back into the original request
 *
 * Force mode keeps full-message Headroom compression for manual experiments.
 */

import type { ModelSlot } from "../providers/types.js";
 import { compress } from "headroom-ai";
 
 export type HeadroomMode = "off" | "adaptive" | "force";

export type HeadroomConfig = {
  enabled: boolean;
  mode: HeadroomMode;
  url?: string;
  minTokens: number;
  contextRatio: number;
  tailCompression: TailCompressionConfig;
};

export type HeadroomProtocol = "openai-chat" | "anthropic-messages";

export type HeadroomReason =
  | "disabled"
  | "force"
  | "headroom_compress"
  | "no_compression";

export type HeadroomResult<TBody> = {
  body: TBody;
  applied: boolean;
  reason: HeadroomReason;
  compression?: {
    originalChars: number;
    compressedChars: number;
    blocks: number;
  };
};

type EnvLike = Record<string, string | undefined>;
type FetchLike = typeof fetch;

type OpenAIToolMessage = {
  role: "tool";
  content: string;
  tool_call_id?: string;
};

type TailTarget<TBody extends Record<string, unknown>> = {
  originalChars: number;
  messages: OpenAIToolMessage[];
  apply: (body: TBody, compressed: unknown[]) => TBody | null;
};

function readBool(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

function readMode(value: string | undefined): HeadroomMode {
  if (value === "force" || value === "adaptive" || value === "off") return value;
  return "off";
}

 function readNumber(value: string | undefined, fallback: number): number {
   if (!value) return fallback;
   const parsed = Number(value);
   return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
 }
 
 export type TailCompressionConfig = {
   enabled: boolean;
   minChars: number;
   maxChars: number;
 };
 
 export function loadTailCompressionConfig(env: EnvLike = process.env): TailCompressionConfig {
   return {
     enabled: readBool(env["MINIROUTER_TAIL_COMPRESSION_ENABLED"]),
     minChars: readNumber(env["MINIROUTER_TAIL_COMPRESSION_MIN_CHARS"], 12_000),
     maxChars: readNumber(env["MINIROUTER_TAIL_COMPRESSION_MAX_CHARS"], 2_000),
   };
 }
 
 export function loadHeadroomConfig(env: EnvLike = process.env): HeadroomConfig {
  const enabled = readBool(env["MINIROUTER_HEADROOM_ENABLED"]);
  const mode = enabled ? readMode(env["MINIROUTER_HEADROOM_MODE"] ?? "adaptive") : "off";
  return {
    enabled,
    mode,
    url: env["MINIROUTER_HEADROOM_URL"],
    minTokens: readNumber(env["MINIROUTER_HEADROOM_MIN_TOKENS"], 8000),
    contextRatio: readNumber(env["MINIROUTER_HEADROOM_CONTEXT_RATIO"], 0.85),
    tailCompression: loadTailCompressionConfig(env),
  };
}

function isOversizedTail(content: string, config: TailCompressionConfig): boolean {
  return config.enabled && content.length >= config.minChars;
}

function extractMessages(body: Record<string, unknown>): unknown[] | undefined {
  const msgs = body["messages"];
  return Array.isArray(msgs) ? msgs : undefined;
}

function setMessages<TBody extends Record<string, unknown>>(
  body: TBody,
  messages: unknown[],
): TBody {
  return { ...body, messages } as TBody;
}

function compressedToolContent(messages: unknown[]): string | null {
  const first = messages[0];
  if (typeof first !== "object" || first === null) return null;
  const content = (first as Record<string, unknown>)["content"];
  return typeof content === "string" ? content : null;
}

function openAITailTargets<TBody extends Record<string, unknown>>(
  body: TBody,
  config: TailCompressionConfig,
): TailTarget<TBody>[] {
  const messages = extractMessages(body);
  if (!messages) return [];

  return messages.flatMap((message, index): TailTarget<TBody>[] => {
    if (typeof message !== "object" || message === null) return [];
    const record = message as Record<string, unknown>;
    if (record["role"] !== "tool" || typeof record["content"] !== "string") return [];
    if (!isOversizedTail(record["content"], config)) return [];

    const toolMessage: OpenAIToolMessage = {
      role: "tool",
      content: record["content"],
    };
    if (typeof record["tool_call_id"] === "string") {
      toolMessage.tool_call_id = record["tool_call_id"];
    }

    return [{
      originalChars: record["content"].length,
      messages: [toolMessage],
      apply: (currentBody, compressed) => {
        const content = compressedToolContent(compressed);
        if (!content) return null;
        const currentMessages = extractMessages(currentBody);
        if (!currentMessages) return null;
        const nextMessages = [...currentMessages];
        nextMessages[index] = { ...(nextMessages[index] as Record<string, unknown>), content };
        return setMessages(currentBody, nextMessages);
      },
    }];
  });
}

function anthropicTailTargets<TBody extends Record<string, unknown>>(
  body: TBody,
  config: TailCompressionConfig,
): TailTarget<TBody>[] {
  const messages = extractMessages(body);
  if (!messages) return [];

  const targets: TailTarget<TBody>[] = [];
  messages.forEach((message, messageIndex) => {
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    const content = record["content"];
    if (!Array.isArray(content)) return;

    content.forEach((part, partIndex) => {
      if (typeof part !== "object" || part === null) return;
      const block = part as Record<string, unknown>;
      if (block["type"] !== "tool_result" || typeof block["content"] !== "string") return;
      if (!isOversizedTail(block["content"], config)) return;

      const toolMessage: OpenAIToolMessage = {
        role: "tool",
        content: block["content"],
      };
      if (typeof block["tool_use_id"] === "string") {
        toolMessage.tool_call_id = block["tool_use_id"];
      }

      targets.push({
        originalChars: block["content"].length,
        messages: [toolMessage],
        apply: (currentBody, compressed) => {
          const compressedContent = compressedToolContent(compressed);
          if (!compressedContent) return null;
          const currentMessages = extractMessages(currentBody);
          if (!currentMessages) return null;
          const currentMessage = currentMessages[messageIndex];
          if (typeof currentMessage !== "object" || currentMessage === null) return null;
          const currentContent = (currentMessage as Record<string, unknown>)["content"];
          if (!Array.isArray(currentContent)) return null;

          const nextContent = [...currentContent];
          nextContent[partIndex] = { ...(nextContent[partIndex] as Record<string, unknown>), content: compressedContent };
          const nextMessages = [...currentMessages];
          nextMessages[messageIndex] = { ...(currentMessage as Record<string, unknown>), content: nextContent };
          return setMessages(currentBody, nextMessages);
        },
      });
    });
  });

  return targets;
}

function tailTargets<TBody extends Record<string, unknown>>(
  protocol: HeadroomProtocol,
  body: TBody,
  config: TailCompressionConfig,
): TailTarget<TBody>[] {
  if (protocol === "openai-chat") return openAITailTargets(body, config);
  return anthropicTailTargets(body, config);
}

async function compressTargetsWithHeadroom<TBody extends Record<string, unknown>>(input: {
  body: TBody;
  slot: ModelSlot;
  config: HeadroomConfig;
  targets: TailTarget<TBody>[];
}): Promise<HeadroomResult<TBody>> {
  const traceEnabled = process.env["MINIROUTER_TRACE_LOG"] === "true";
  let body = input.body;
  let applied = false;
  let originalChars = 0;
  let compressedChars = 0;
  let blocks = 0;

  for (const target of input.targets) {
    try {
      if (traceEnabled) {
        console.error(`[MiniRouter trace] headroom_tail_start chars=${target.originalChars}`);
      }
      const result = await compress(target.messages, {
        model: input.slot.model,
        baseUrl: input.config.url,
        timeout: 15_000,
        fallback: false,
      });

      if (!result.compressed || !result.messages) continue;
      if (traceEnabled) {
        console.error(`[MiniRouter trace] headroom_tail_done tokens=${result.tokensBefore}->${result.tokensAfter}`);
      }
      const nextBody = target.apply(body, result.messages);
      if (!nextBody) continue;

      body = nextBody;
      applied = true;
      originalChars += target.originalChars;
      compressedChars += result.tokensAfter * 4;
      blocks += Math.max(1, result.transformsApplied.length);
    } catch (error) {
      console.error("[MiniRouter] Headroom tail compress failed:", (error as Error).message);
    }
  }

  if (!applied) {
    return { body: input.body, applied: false, reason: "no_compression" };
  }

  console.error(
    `[MiniRouter] Headroom tail compression applied blocks=${blocks} chars=${originalChars}->${compressedChars}`,
  );
  return {
    body,
    applied: true,
    reason: "headroom_compress",
    compression: {
      originalChars,
      compressedChars,
      blocks,
    },
  };
}

async function compressFullWithHeadroom<TBody extends Record<string, unknown>>(input: {
  body: TBody;
  slot: ModelSlot;
  config: HeadroomConfig;
}): Promise<HeadroomResult<TBody>> {
  const messages = extractMessages(input.body);
  if (!input.config.url || !messages) {
    return { body: input.body, applied: false, reason: "no_compression" };
  }

  try {
    const result = await compress(messages, {
      model: input.slot.model,
      baseUrl: input.config.url,
      timeout: 15_000,
      fallback: false,
    });

    if (!result.compressed || !result.messages) {
      return { body: input.body, applied: false, reason: "no_compression" };
    }

    return {
      body: setMessages(input.body, result.messages),
      applied: true,
      reason: "headroom_compress",
      compression: {
        originalChars: result.tokensBefore * 4,
        compressedChars: result.tokensAfter * 4,
        blocks: result.transformsApplied.length,
      },
    };
  } catch (error) {
    console.error("[MiniRouter] Headroom full compress failed:", (error as Error).message);
    return { body: input.body, applied: false, reason: "no_compression" };
  }
}

export async function optimizeWithHeadroom<TBody extends Record<string, unknown>>(input: {
  protocol: HeadroomProtocol;
  body: TBody;
  slot: ModelSlot;
  config?: HeadroomConfig;
  /** kept for API compatibility; headroom-ai handles HTTP */
  fetchImpl?: FetchLike;
}): Promise<HeadroomResult<TBody>> {
  const config = input.config ?? loadHeadroomConfig();

  if (!config.enabled || config.mode === "off") {
    return { body: input.body, applied: false, reason: "disabled" };
  }

  if (config.mode === "force") {
    return compressFullWithHeadroom({
      body: input.body,
      slot: input.slot,
      config,
    });
  }

  if (!config.url) {
    return { body: input.body, applied: false, reason: "no_compression" };
  }

  const targets = tailTargets(input.protocol, input.body, config.tailCompression);
  if (process.env["MINIROUTER_TRACE_LOG"] === "true") {
    console.error(`[MiniRouter trace] headroom_tail_targets=${targets.length}`);
  }
  if (targets.length === 0) {
    return { body: input.body, applied: false, reason: "no_compression" };
  }

  return compressTargetsWithHeadroom({
    body: input.body,
    slot: input.slot,
    config,
    targets,
  });
}
