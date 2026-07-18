/* eslint-disable @typescript-eslint/no-explicit-any -- debug endpoint accepts raw OpenAI-compatible JSON. */

import type { Context } from "hono";
import { eq } from "drizzle-orm";

import { getDb } from "../../db/connection.js";
import { modelScores } from "../../db/schema.js";
import { normalizeOpenAIChatRequest } from "../../protocols/openai-chat.js";
import { buildRouteReceipt, type CatalogModel, type RouteProfile } from "../../routing/debug/route.js";
import { extractRoutingFeatures } from "../../routing/features/extractor.js";
import { selectConfiguredSlotForChat } from "./chat.js";
import { loadModelSlotsFromEnv } from "../../providers/env.js";

type ModelScoreRow = typeof modelScores.$inferSelect;
type EnvLike = Record<string, string | undefined>;

export function mapModelScoreToCatalogModel(row: ModelScoreRow): CatalogModel {
  return {
    id: row.id,
    displayName: row.displayName,
    provider: row.provider,
    type: row.type,
    priceInput: row.priceInput,
    priceOutput: row.priceOutput,
    scoreCoding: row.scoreCoding,
    scoreReasoning: row.scoreReasoning,
    scoreChinese: row.scoreChinese,
    scoreOverall: row.scoreOverall,
    scoreSpeed: row.scoreSpeed,
    hasVision: row.hasVision === 1,
    hasVideo: row.hasVideo === 1,
    hasAudio: row.hasAudio === 1,
    contextWindow: row.contextWindow,
    maxOutput: row.maxOutput,
    supportsTools: row.supportsTools === 1,
    supportsJson: row.supportsJson === 1,
    isActive: row.isActive === 1,
    priority: row.priority,
  };
}

function parseProfile(value: string | undefined): RouteProfile {
  if (value === "eco" || value === "premium") return value;
  return "auto";
}

export async function buildEnvSlotDebugReceipt(body: any, env: EnvLike = process.env) {
  const request = normalizeOpenAIChatRequest(body);
  const features = extractRoutingFeatures(request);
  const configured = await selectConfiguredSlotForChat(body, env, { discoverFromDb: false });

  if (!configured) {
    return {
      source: "env-slot" as const,
      protocol: "openai-chat" as const,
      features,
      error: {
        message:
          "MiniRouter has no configured model slots. Configure BALANCED, STRONG, and VISION for the routing MVP.",
        type: "configuration_error",
      },
    };
  }

  return {
    source: "env-slot" as const,
    protocol: "openai-chat" as const,
    tier: configured.tier,
    features,
    selectedSlot: {
      slot: configured.slot.slot,
      provider: configured.slot.provider,
      model: configured.slot.model,
      baseUrl: configured.slot.baseUrl,
      supportsTools: configured.slot.supportsTools,
      supportsVision: configured.slot.supportsVision,
      contextWindowTokens: configured.slot.contextWindowTokens,
    },
  };
}

export async function debugRoute(c: Context) {
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    // GET request or no body; use empty body for env-slot debug
  }
  const profile = parseProfile(c.req.query("profile") ?? body.profile);
  const source = c.req.query("source") ?? c.req.query("mode") ?? body.source ?? body.mode;
  const protocol = body.protocol ?? "openai-chat";

  if (protocol !== "openai-chat") {
    return c.json(
      {
        error: {
          message: `Unsupported debug route protocol: ${protocol}`,
          type: "unsupported_protocol",
        },
      },
      400,
    );
  }

  const envSlots = loadModelSlotsFromEnv();
  const hasEnv = Object.keys(envSlots).length > 0;
  const useEnvSlot = source === "env-slot" || (source == null && hasEnv) || source == null;

  if (useEnvSlot) {
    try {
      return c.json(await buildEnvSlotDebugReceipt(body));
    } catch (e: any) {
      if (e.message && e.message.includes("No configured model slot")) {
        // fall through to catalog or error
      } else {
        throw e;
      }
    }
  }

  const db = getDb();
  const rows = await db.select().from(modelScores).where(eq(modelScores.isActive, 1));
  const catalog = rows.map(mapModelScoreToCatalogModel);

  if (catalog.length === 0) {
    return c.json(
      {
        error: {
          message:
            "No models in catalog. Run `npm run seed:models` to populate model scores for debug/catalog routing.",
          type: "no_catalog_models",
        },
      },
      400,
    );
  }

  const request = normalizeOpenAIChatRequest(body);
  try {
    const receipt = buildRouteReceipt(request, catalog, { profile });
    return c.json({
      ...receipt,
      modelCount: catalog.length,
    });
  } catch (err: any) {
    if (err.message === "No eligible model for request requirements") {
      return c.json(
        {
          error: {
            message: err.message,
            type: "no_eligible_model",
          },
        },
        400,
      );
    }
    throw err;
  }
}
