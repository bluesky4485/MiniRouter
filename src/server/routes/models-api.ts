/**
 * Models API Routes
 *
 * GET  /api/models        — list all models (with filters)
 * GET  /api/models/:id    — get single model
 * PUT  /api/models/:id    — update model (price, scores, tier, notes)
 */

import type { Context } from "hono";
import { getDb } from "../../db/connection.js";
import { modelScores } from "../../db/schema.js";
import { eq, and, like, sql } from "drizzle-orm";

export async function listModels(c: Context) {
  const db = getDb();

  // Filters
  const tier = c.req.query("tier"); // "domestic" | "international" | "deprecated"
  const provider = c.req.query("provider");
  const search = c.req.query("search");
  const isActive = c.req.query("active");
  const hasVision = c.req.query("vision");
  const supportsTools = c.req.query("tools");

  const conditions = [];
  if (tier) conditions.push(eq(modelScores.tier, tier));
  if (provider) conditions.push(eq(modelScores.provider, provider));
  if (isActive === "true") conditions.push(eq(modelScores.isActive, 1));
  if (isActive === "false") conditions.push(eq(modelScores.isActive, 0));
  if (hasVision === "true") conditions.push(eq(modelScores.hasVision, 1));
  if (supportsTools === "true") conditions.push(eq(modelScores.supportsTools, 1));

  const query = conditions.length > 0
    ? db.select().from(modelScores).where(and(...conditions))
    : db.select().from(modelScores);

  const rows = await query;

  // Client-side search filter (SQLite LIKE doesn't work well with Chinese)
  let result = rows;
  if (search) {
    const q = search.toLowerCase();
    result = rows.filter((r) =>
      r.displayName.toLowerCase().includes(q) ||
      r.provider.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (r.notes && r.notes.toLowerCase().includes(q)),
    );
  }

  // Map snake_case DB columns to camelCase JSON
  const models = result.map((r) => ({
    id: r.id,
    provider: r.provider,
    displayName: r.displayName,
    tier: r.tier,
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
    isActive: !!r.isActive,
    priority: r.priority,
    releaseDate: r.releaseDate,
    notes: r.notes,
    verified: !!r.verified,
    updatedAt: r.updatedAt,
  }));

  return c.json({ data: models, count: models.length });
}

export async function getModel(c: Context) {
  const db = getDb();
  const id = c.req.param("id");
  const row = await db.select().from(modelScores).where(eq(modelScores.id, id)).limit(1);

  if (!row.length) return c.json({ error: "Model not found" }, 404);

  const r = row[0];
  return c.json({
    id: r.id,
    provider: r.provider,
    displayName: r.displayName,
    tier: r.tier,
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
    isActive: !!r.isActive,
    priority: r.priority,
    releaseDate: r.releaseDate,
    notes: r.notes,
    verified: !!r.verified,
  });
}

export async function updateModel(c: Context) {
  const db = getDb();
  const id = c.req.param("id");
  const body = await c.req.json();

  // Only allow updating specific fields
  const allowed = ["tier", "priceInput", "priceOutput", "priceCacheHit",
    "scoreCoding", "scoreReasoning", "scoreChinese", "scoreCreative", "scoreSpeed", "scoreOverall",
    "isActive", "priority", "notes", "verified", "orRank", "orWeeklyVolume", "orWeeklyChange"];
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  for (const key of Object.keys(body)) {
    const dbKey = key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()); // camelCase → snake_case
    if (allowed.includes(dbKey)) {
      updates[dbKey] = body[key];
    }
  }

  await db.update(modelScores).set(updates as any).where(eq(modelScores.id, id));
  return c.json({ status: "updated", id });
}
