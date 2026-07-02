/**
 * POST /v1/chat/completions — OpenAI-compatible chat completions route
 *
 * This is the main routing entry point. It delegates to the existing
 * ClawRouter proxy logic, wrapped with multi-user auth + rate limiting.
 * In Phase 1, it starts the existing proxy and forwards requests.
 * In Phase 2, the routing logic will be refactored into standalone functions.
 */

import type { Context } from "hono";
import type { AuthResult } from "../../auth/types.js";
import { route, DEFAULT_ROUTING_CONFIG } from "../../router/index.js";
import {
  BLOCKRUN_MODELS,
  resolveModelAlias,
  getModelContextWindow,
} from "../../models.js";
import { logUsage } from "../../db/queries/usage.js";
import { randomUUID } from "node:crypto";

/**
 * POST /v1/chat/completions
 *
 * Accepts standard OpenAI chat completion requests.
 * When model is "minirouter/auto|eco|premium", invokes the routing engine.
 * When model is an explicit model ID, forwards directly.
 *
 * In Phase 1, this is a thin wrapper that:
 * 1. Parses the request body
 * 2. Runs routing classification (if auto/eco/premium)
 * 3. Logs the usage
 * 4. Delegates to the existing proxy for actual LLM calls
 */
export async function chatCompletions(c: Context) {
  const auth = c.get("auth") as AuthResult;
  const body = await c.req.json();
  const requestId = randomUUID();

  // Parse routing profile from model or header
  const modelParam: string = body.model ?? "minirouter/auto";
  const headerProfile = c.req.header("x-routing-profile");

  // Detect routing profile
  let routingProfile: "eco" | "auto" | "premium" | undefined;
  const normalizedModel = modelParam.toLowerCase();

  if (normalizedModel === "minirouter/eco" || normalizedModel === "eco") {
    routingProfile = "eco";
  } else if (normalizedModel === "minirouter/premium" || normalizedModel === "premium") {
    routingProfile = "premium";
  } else if (headerProfile === "eco" || headerProfile === "premium") {
    routingProfile = headerProfile;
  }

  const isRoutingModel =
    normalizedModel === "minirouter/auto" ||
    normalizedModel === "minirouter/eco" ||
    normalizedModel === "minirouter/premium" ||
    normalizedModel === "auto" ||
    normalizedModel === "eco" ||
    normalizedModel === "premium";

  // Build prompt from messages
  const messages: Array<{ role: string; content: string }> = body.messages ?? [];
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsg = messages.find((m) => m.role === "user");
  const prompt = userMsg?.content ?? "";
  const systemPrompt = systemMsg?.content;
  const maxOutputTokens = body.max_tokens ?? body.maxTokens ?? 4096;
  const hasTools = !!(body.tools && body.tools.length > 0);

  let selectedModel: string;
  let tier: string | undefined;
  let strategy: string | undefined;
  let costEstimate = 0;
  let baselineCost = 0;
  let savingsPct: number | undefined;

  if (isRoutingModel) {
    // Build model pricing map from BLOCKRUN_MODELS
    const modelPricing = new Map(
      BLOCKRUN_MODELS.map((m) => [
        m.id,
        { inputPrice: m.inputPrice, outputPrice: m.outputPrice, flatPrice: m.flatPrice },
      ]),
    );

    try {
      const decision = route(prompt, systemPrompt, maxOutputTokens, {
        config: DEFAULT_ROUTING_CONFIG,
        modelPricing,
        routingProfile,
        hasTools,
      });

      selectedModel = decision.model;
      tier = decision.tier;
      strategy = decision.method;
      costEstimate = decision.costEstimate;
      baselineCost = decision.baselineCost;
      savingsPct = decision.savings;
    } catch {
      // Routing failed — fall back to default free model
      selectedModel = "free/gpt-oss-120b";
      tier = "SIMPLE";
      strategy = "rules";
    }
  } else {
    // Explicit model — resolve alias and use directly
    selectedModel = resolveModelAlias(modelParam);
    strategy = "direct";
  }

  // Log usage (async, don't await)
  logUsage({
    userId: auth.userId,
    apiKeyId: auth.apiKeyId,
    requestId,
    model: selectedModel,
    tier,
    profile: routingProfile,
    strategy,
    inputTokens: Math.ceil(prompt.length / 4),
    outputTokens: 0, // Will be updated after response
    costUsd: costEstimate,
    baselineCostUsd: baselineCost,
    savingsPct,
    status: "success",
    hasTools,
    isStreaming: body.stream === true,
    hasVision: false,
  }).catch(() => {
    // Log failure is non-fatal
  });

  // Phase 1: return routing decision as response (proxy integration Phase 2)
  // Real LLM call will be wired in when proxy.ts is refactored
  return c.json({
    id: `chatcmpl-${requestId.slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: selectedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `[MiniRouter Phase 1] Routing decision: ${selectedModel} (${tier ?? "N/A"})`,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: Math.ceil(prompt.length / 4),
      completion_tokens: 20,
      total_tokens: Math.ceil(prompt.length / 4) + 20,
    },
    x_minirouter_tier: tier,
    x_minirouter_profile: routingProfile ?? "auto",
    x_minirouter_cost_usd: costEstimate,
    x_minirouter_savings_pct: savingsPct ? `${(savingsPct * 100).toFixed(0)}%` : null,
  });
}
