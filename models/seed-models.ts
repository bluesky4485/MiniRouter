/**
 * Model Scorecard Seed Script
 * Populates SQLite with all models from seed-data.json.
 * Run: npx tsx models/seed-models.ts
 */
import { getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { modelScores } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SeedModel {
  id: string;
  provider: string;
  displayName: string;
  type: string;
  pricing: { input: number | null; output: number | null; cacheHit: number | null };
  scores: { coding: number | null; reasoning: number | null; chinese: number | null; creative: number | null; speed: number | null };
  multimodal: { vision: boolean; video: boolean; audio: boolean };
  specs: { contextWindow: number | null; maxOutput: number | null; supportsTools: boolean; supportsJson: boolean };
  isActive: boolean;
  releaseDate: string;
  notes: string | null;
  verified: boolean;
  sourcePricing?: string | null;
  sourceBenchmark?: string | null;
}

async function main() {
  await runMigrations();
  const db = getDb();
  const dataPath = join(__dirname, "seed-data.json");
  const raw = readFileSync(dataPath, "utf-8");
  const models: SeedModel[] = JSON.parse(raw);

  console.log(`Seeding ${models.length} models...`);
  const now = new Date().toISOString();
  let inserted = 0, updated = 0;

  for (const m of models) {
    const values: Record<string, unknown> = {
      id: m.id, provider: m.provider, displayName: m.displayName, type: m.type,
      priceInput: m.pricing.input, priceOutput: m.pricing.output, priceCacheHit: m.pricing.cacheHit,
      scoreCoding: m.scores.coding, scoreReasoning: m.scores.reasoning,
      scoreChinese: m.scores.chinese, scoreCreative: m.scores.creative, scoreSpeed: m.scores.speed,
      hasVision: m.multimodal.vision ? 1 : 0, hasVideo: m.multimodal.video ? 1 : 0, hasAudio: m.multimodal.audio ? 1 : 0,
      contextWindow: m.specs.contextWindow, maxOutput: m.specs.maxOutput,
      supportsTools: m.specs.supportsTools ? 1 : 0, supportsJson: m.specs.supportsJson ? 1 : 0,
      isActive: m.isActive ? 1 : 0, releaseDate: m.releaseDate, notes: m.notes, verified: m.verified ? 1 : 0,
      sourcePricing: m.sourcePricing ?? null, sourceBenchmark: m.sourceBenchmark ?? null,
      createdAt: now, updatedAt: now,
    };

    const existing = await db.select({ id: modelScores.id }).from(modelScores).where(eq(modelScores.id, m.id)).limit(1);
    if (existing.length > 0) {
      const { id: _, ...rest } = values;
      await db.update(modelScores).set(rest).where(eq(modelScores.id, m.id));
      updated++;
    } else {
      await db.insert(modelScores).values(values as any);
      inserted++;
    }
  }
  console.log(`Done. Inserted ${inserted}, Updated ${updated}, Total ${models.length}.`);
  console.log(`Database: ${join(homedir(), ".minirouter", "minirouter.db")}`);
}

main().catch((err) => { console.error("Seed failed:", err); process.exit(1); });