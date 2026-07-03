import { loadDotEnv } from "../config/dotenv.js";
import { runMigrations } from "../db/migrations.js";
import { getDb } from "../db/connection.js";
import { users } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

loadDotEnv();
const [{ PROXY_PORT }, { createApp }] = await Promise.all([
  import("../config.js"),
  import("./app.js"),
]);

// ─── Auto-migrate database on startup ─────────────────────────────────
await runMigrations();

// ─── Solo user bootstrap ──────────────────────────────────────────────
// In solo/local mode a virtual "solo" user is used for auth.
// Ensure it exists in the DB so usage_logs foreign-key inserts don't fail.
const db = getDb();
const soloExists = await db
  .select()
  .from(users)
  .where(eq(users.id, "solo"))
  .limit(1);

if (!soloExists.length) {
  const now = new Date().toISOString();
  db.run(
    sql`INSERT INTO users (
      id, email, name, routing_profile, routing_strategy,
      role, is_active, created_at, updated_at
    ) VALUES ('solo', 'solo@localhost', 'Solo (Local Dev)', 'auto', 'rules', 'admin', 1, ${now}, ${now})`
  );
  console.log("[MiniRouter] solo user initialized");
}

// ─── Start HTTP server ────────────────────────────────────────────────
const { serve } = await import("@hono/node-server");
const app = createApp();

serve(
  {
    fetch: app.fetch,
    port: PROXY_PORT,
  },
  (info) => {
    console.log(`[MiniRouter] listening on http://localhost:${info.port}`);
    console.log(`[MiniRouter] dashboard: http://localhost:${info.port}/models/dashboard`);
  },
);