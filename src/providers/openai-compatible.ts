import type { ModelSlot } from "./types.js";
import { adaptOpenAICompatibleBody } from "./client-adapter.js";
import { debugLog } from "../debug.js";

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes — LLM responses can be slow

function readTimeout(env: Record<string, string | undefined> = process.env): number {
  const raw = env["MINIROUTER_UPSTREAM_TIMEOUT_MS"];
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

export async function executeOpenAICompatibleChat(
  body: Record<string, unknown>,
  slot: ModelSlot,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  // Client adapter — fix known client issues (e.g. Claude Code empty image_url.detail)
  const adapted = adaptOpenAICompatibleBody(body);

  const upstreamBody: Record<string, unknown> = {
    ...adapted,
    model: slot.model,
  };

  debugLog("openai-chat:upstream body", upstreamBody);

  return fetchImpl(chatCompletionsUrl(slot.baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${slot.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(readTimeout()),
  });
}