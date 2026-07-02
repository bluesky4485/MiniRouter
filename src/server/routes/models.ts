/**
 * GET /v1/models — List available models (OpenAI-compatible)
 */

import type { Context } from "hono";
import { VISIBLE_OPENCLAW_MODELS } from "../../models.js";

/**
 * GET /v1/models
 *
 * Returns all available models in OpenAI format.
 * In Phase 2, this will filter by user permissions.
 */
export async function listModels(c: Context) {
  const models = VISIBLE_OPENCLAW_MODELS.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: "minirouter",
  }));

  // Add virtual routing profiles
  const virtualModels = [
    {
      id: "minirouter/auto",
      object: "model" as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: "minirouter",
    },
    {
      id: "minirouter/eco",
      object: "model" as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: "minirouter",
    },
    {
      id: "minirouter/premium",
      object: "model" as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: "minirouter",
    },
  ];

  // Simple paging (LiteLLM-style)
  const after = c.req.query("after");
  let data = [...virtualModels, ...models];
  if (after) {
    const idx = data.findIndex((m) => m.id === after);
    if (idx >= 0) {
      data = data.slice(idx + 1);
    }
  }

  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);
  const page = data.slice(0, limit);

  return c.json({
    object: "list",
    data: page,
    has_more: data.length > limit,
  });
}
