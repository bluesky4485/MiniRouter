/**
 * Model Scorecard Seed Script
 *
 * Populates the SQLite database with all models from the master model registry.
 * Run: npx tsx src/db/seed-models.ts
 *
 * This script reads from a standalone JSON data file (seed-data.json)
 * and upserts into the model_scores table.
 */

import { getDb } from "./connection.js";
import { runMigrations } from "./migrations.js";
import { modelScores } from "./schema.js";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SeedModel {
  id: string;
  provider: string;
  displayName: string;
  tier: string;
  pricing: { input: number; output: number; cacheHit: number | null; peakMultiplier: number | null; peakHours: string | null; tokenPlan: string | null };
  scores: { coding: number; reasoning: number; chinese: number; creative: number; speed: number; overall: number };
  multimodal: { vision: boolean; video: boolean; audio: boolean };
  specs: { contextWindow: number; maxOutput: number; supportsTools: boolean; supportsJson: boolean };
  or_rank: number | null;
  or_weeklyVolume: string | null;
  or_weeklyChange: string | null;
  isActive: boolean;
  priority: number;
  releaseDate: string;
  notes: string;
  verified: boolean;
}

async function main() {
  // 1. Ensure DB + tables exist
  await runMigrations();
  const db = getDb();

  // 2. Load seed data
  const dataPath = join(__dirname, "seed-data.json");
  const raw = readFileSync(dataPath, "utf-8");
  const models: SeedModel[] = JSON.parse(raw);

  console.log(`Seeding ${models.length} models into model_scores table...`);

  // 3. Upsert each model
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;

  for (const m of models) {
    const values = {
      id: m.id,
      provider: m.provider,
      displayName: m.displayName,
      tier: m.tier,
      priceInput: m.pricing.input,
      priceOutput: m.pricing.output,
      priceCacheHit: m.pricing.cacheHit,
      peakMultiplier: m.pricing.peakMultiplier,
      peakHours: m.pricing.peakHours,
      tokenPlan: m.pricing.tokenPlan,
      scoreCoding: m.scores.coding,
      scoreReasoning: m.scores.reasoning,
      scoreChinese: m.scores.chinese,
      scoreCreative: m.scores.creative,
      scoreSpeed: m.scores.speed,
      scoreOverall: m.scores.overall,
      hasVision: m.multimodal.vision ? 1 : 0,
      hasVideo: m.multimodal.video ? 1 : 0,
      hasAudio: m.multimodal.audio ? 1 : 0,
      contextWindow: m.specs.contextWindow,
      maxOutput: m.specs.maxOutput,
      supportsTools: m.specs.supportsTools ? 1 : 0,
      supportsJson: m.specs.supportsJson ? 1 : 0,
      orRank: m.or_rank,
      orWeeklyVolume: m.or_weeklyVolume,
      orWeeklyChange: m.or_weeklyChange,
      isActive: m.isActive ? 1 : 0,
      priority: m.priority,
      releaseDate: m.releaseDate,
      notes: m.notes,
      verified: m.verified ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    };

    // Check if exists
    const existing = await db.select({ id: modelScores.id }).from(modelScores).where(eq(modelScores.id, m.id)).limit(1);

    if (existing.length > 0) {
      // Update
      await db.update(modelScores).set({ ...values, createdAt: undefined }).where(eq(modelScores.id, m.id));
      updated++;
    } else {
      // Insert
      await db.insert(modelScores).values(values);
      inserted++;
    }
  }

  console.log(`Done. Inserted ${inserted}, Updated ${updated}, Total ${models.length}.`);
  console.log(`Database: ${join(require("node:os").homedir(), ".minirouter", "minirouter.db")}`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
