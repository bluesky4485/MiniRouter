import type { ModelSlot } from "./types.js";
import { adaptOpenAICompatibleBody } from "./client-adapter.js";
import { debugLog, debugLogResponse } from "../debug.js";

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes

function readTimeout(env: Record<string, string | undefined> = process.env): number {
  const raw = env["MINIROUTER_UPSTREAM_TIMEOUT_MS"];
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function messagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  return `${trimmed}/messages`;
}

export async function executeAnthropicMessages(
  body: Record<string, unknown>,
  slot: ModelSlot,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  // Client adapter — Claude Code sends OpenAI-style image_url blocks even on
  // the /v1/messages endpoint. Fix empty detail so upstreams don't 400.
  const adapted = adaptOpenAICompatibleBody(body);

  const upstreamBody: Record<string, unknown> = {
    ...adapted,
    model: slot.model,
  };

  debugLog(`anthropic:upstream body`, upstreamBody);

  const res = await fetchImpl(messagesUrl(slot.baseUrl), {
    method: "POST",
    headers: {
      "x-api-key": slot.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(readTimeout()),
  });

  // Log upstream error responses for debugging
  if (!res.ok) {
    const errorText = await res.text();
    debugLogResponse("anthropic:upstream", res.status, errorText);
    // Return the error response as-is
    return new Response(errorText, {
      status: res.status,
      headers: res.headers,
    });
  }

  return res;
}