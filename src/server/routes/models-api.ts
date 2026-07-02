/**
 * Database-backed model score routes.
 *
 * GET /api/models      - list model scorecards for the dashboard
 * GET /api/models/:id  - get one model scorecard
 * PUT /api/models/:id  - update editable scorecard fields
 */

import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection.js";
import { modelScores } from "../../db/schema.js";

type ModelScoreRow = typeof modelScores.$inferSelect;

export function mapModelScoreRow(r: ModelScoreRow) {
  const dataStatus = r.verified ? "confirmed" : r.notes ? "partial" : "unverified";
  const importedFromLlmStats = r.notes?.includes("Imported from LLM Stats") ?? false;

  return {
    id: r.id,
    provider: r.provider,
    displayName: r.displayName,
    type: r.type,
    dataStatus,
    pricing: {
      input: r.priceInput,
      output: r.priceOutput,
      cacheHit: r.priceCacheHit,
      peakMultiplier: r.peakMultiplier,
      peakHours: r.peakHours,
      tokenPlan: r.tokenPlan,
    },
    scores: {
      coding: r.scoreCoding,
      reasoning: r.scoreReasoning,
      chinese: r.scoreChinese,
      creative: r.scoreCreative,
      speed: r.scoreSpeed,
      overall: r.scoreOverall,
    },
    multimodal: {
      vision: !!r.hasVision,
      video: !!r.hasVideo,
      audio: !!r.hasAudio,
    },
    specs: {
      contextWindow: r.contextWindow,
      maxOutput: r.maxOutput,
      supportsTools: !!r.supportsTools,
      supportsJson: !!r.supportsJson,
    },
    openrouter: {
      rank: r.orRank,
      weeklyVolume: r.orWeeklyVolume,
      weeklyChange: r.orWeeklyChange,
    },
    sourcePricing: r.sourcePricing ?? undefined,
    sourceBenchmark: r.sourceBenchmark
      ? r.sourceBenchmark
      : importedFromLlmStats
        ? "https://llm-stats.com/leaderboards/llm-leaderboard"
        : undefined,
    isActive: !!r.isActive,
    priority: r.priority,
    releaseDate: r.releaseDate,
    notes: r.notes,
    verified: !!r.verified,
    updatedAt: r.updatedAt,
  };
}

export async function listModelScores(c: Context) {
  const db = getDb();

  const type = c.req.query("type") ?? c.req.query("tier");
  const provider = c.req.query("provider");
  const search = c.req.query("search");
  const isActive = c.req.query("active");
  const hasVision = c.req.query("vision");
  const supportsTools = c.req.query("tools");

  const conditions = [];
  if (type) conditions.push(eq(modelScores.type, type));
  if (provider) conditions.push(eq(modelScores.provider, provider));
  if (isActive === "true") conditions.push(eq(modelScores.isActive, 1));
  if (isActive === "false") conditions.push(eq(modelScores.isActive, 0));
  if (hasVision === "true") conditions.push(eq(modelScores.hasVision, 1));
  if (supportsTools === "true") conditions.push(eq(modelScores.supportsTools, 1));

  const rows = conditions.length > 0
    ? await db.select().from(modelScores).where(and(...conditions))
    : await db.select().from(modelScores);

  let result = rows;
  if (search) {
    const q = search.toLowerCase();
    result = rows.filter((r) =>
      r.displayName.toLowerCase().includes(q) ||
      r.provider.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (r.notes?.toLowerCase().includes(q) ?? false),
    );
  }

  const models = result.map(mapModelScoreRow);
  return c.json({ data: models, count: models.length });
}

export async function getModelScore(c: Context) {
  const db = getDb();
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Model id is required" }, 400);

  const row = await db.select().from(modelScores).where(eq(modelScores.id, id)).limit(1);

  if (!row.length) return c.json({ error: "Model not found" }, 404);

  return c.json(mapModelScoreRow(row[0]));
}

export async function updateModelScore(c: Context) {
  const db = getDb();
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Model id is required" }, 400);

  const body = await c.req.json();
  const allowed = [
    "type",
    "priceInput",
    "priceOutput",
    "priceCacheHit",
    "scoreCoding",
    "scoreReasoning",
    "scoreChinese",
    "scoreCreative",
    "scoreSpeed",
    "scoreOverall",
    "isActive",
    "priority",
    "notes",
    "verified",
    "orRank",
    "orWeeklyVolume",
    "orWeeklyChange",
  ];
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  for (const key of Object.keys(body)) {
    const updateKey = key === "tier" ? "type" : key;
    if (allowed.includes(updateKey)) {
      updates[updateKey] = body[key];
    }
  }

  await db.update(modelScores).set(updates as any).where(eq(modelScores.id, id));
  return c.json({ status: "updated", id });
}
