import type { ModelSlot } from "../providers/types.js";
import {
  compressRequestTail,
  loadTailCompressionConfig,
  type TailCompressionConfig,
} from "./tail-compression.js";

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

export type HeadroomResult<TBody> = {
  body: TBody;
  applied: boolean;
  reason:
    | "disabled"
    | "short_request"
    | "no_url"
    | "force"
    | "min_tokens"
    | "context_headroom"
    | "local_tail_compression";
  compression?: {
    originalChars: number;
    compressedChars: number;
    blocks: number;
  };
};

type EnvLike = Record<string, string | undefined>;
type FetchLike = typeof fetch;

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

function estimateTokens(body: unknown): number {
  return Math.ceil(JSON.stringify(body).length / 4);
}

function maxOutputTokens(body: Record<string, unknown>): number {
  const value = body["max_tokens"] ?? body["max_completion_tokens"];
  return typeof value === "number" ? value : 0;
}

function shouldOptimize<TBody extends Record<string, unknown>>(
  body: TBody,
  slot: ModelSlot,
  config: HeadroomConfig,
): HeadroomResult<TBody>["reason"] {
  if (!config.enabled || config.mode === "off") return "disabled";
  if (config.mode === "force") return "force";

  const inputTokens = estimateTokens(body);
  if (inputTokens >= config.minTokens) return "min_tokens";

  if (slot.contextWindowTokens) {
    const totalTokens = inputTokens + maxOutputTokens(body);
    if (totalTokens >= slot.contextWindowTokens * config.contextRatio) {
      return "context_headroom";
    }
  }

  return "short_request";
}

function optimizeUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/optimize")) return trimmed;
  return `${trimmed}/optimize`;
}

function optimizeLocally<TBody extends Record<string, unknown>>(
  protocol: HeadroomProtocol,
  body: TBody,
  config: HeadroomConfig,
): HeadroomResult<TBody> | null {
  const local = compressRequestTail({
    protocol,
    body,
    config: config.tailCompression,
  });
  if (!local.applied) return null;

  console.error(
    `[MiniRouter] local tail compression applied blocks=${local.compressedBlocks} chars=${local.originalChars}->${local.compressedChars}`,
  );
  return {
    body: local.body,
    applied: true,
    reason: "local_tail_compression",
    compression: {
      originalChars: local.originalChars,
      compressedChars: local.compressedChars,
      blocks: local.compressedBlocks,
    },
  };
}

export async function optimizeWithHeadroom<TBody extends Record<string, unknown>>(input: {
  protocol: HeadroomProtocol;
  body: TBody;
  slot: ModelSlot;
  config?: HeadroomConfig;
  fetchImpl?: FetchLike;
}): Promise<HeadroomResult<TBody>> {
  const config = input.config ?? loadHeadroomConfig();
  const reason = shouldOptimize(input.body, input.slot, config);

  if (reason === "disabled" || reason === "short_request") {
    return { body: input.body, applied: false, reason };
  }

  if (!config.url) {
    const local = optimizeLocally(input.protocol, input.body, config);
    if (local) return local;
    return { body: input.body, applied: false, reason: "no_url" };
  }

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(optimizeUrl(config.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol: input.protocol,
        body: input.body,
        slot: {
          name: input.slot.slot,
          model: input.slot.model,
        },
        policy: {
          mode: config.mode,
          reason,
          protectStaticPrefix: true,
          preserveNativeApiShape: true,
        },
      }),
    });
  } catch (error) {
    const local = optimizeLocally(input.protocol, input.body, config);
    if (local) return local;
    console.error("[MiniRouter] Headroom request failed:", (error as Error).message);
    return { body: input.body, applied: false, reason };
  }

  if (!response.ok) {
    const local = optimizeLocally(input.protocol, input.body, config);
    if (local) return local;
    return { body: input.body, applied: false, reason };
  }

  const payload = (await response.json()) as { body?: TBody };
  return {
    body: payload.body ?? input.body,
    applied: payload.body !== undefined,
    reason,
  };
}
