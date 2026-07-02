import { getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { modelScores } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

await runMigrations();
const db = getDb();
const rows = await db.select().from(modelScores).where(eq(modelScores.id, "deepseek/v4-flash"));
const r = rows[0];
console.log("sourcePricing:", r.sourcePricing);
console.log("sourceBenchmark:", r.sourceBenchmark);
console.log("all keys:", Object.keys(r).join(", "));
