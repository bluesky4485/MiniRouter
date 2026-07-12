import { loadDotEnv } from "../config/dotenv.js";
import { runMigrations } from "../db/migrations.js";
import { getDb } from "../db/connection.js";
import { users } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { createApiKey } from "../auth/apikey.js";
import { createUser, getUserByEmail } from "../db/queries/users.js";

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

// ─── Optional production bootstrap ──────────────────────────────────
// A non-solo deployment otherwise has no initial principal that can call the
// authenticated admin endpoints. Creating it is opt-in and idempotent.
const bootstrapAdminEmail = process.env.MINIROUTER_BOOTSTRAP_ADMIN_EMAIL?.trim();
if (bootstrapAdminEmail) {
  const existingAdmin = await getUserByEmail(bootstrapAdminEmail);
  if (!existingAdmin) {
    const admin = await createUser({
      email: bootstrapAdminEmail,
      name: "Bootstrap admin",
      role: "superadmin",
    });
    const key = await createApiKey({
      userId: admin.id,
      name: "Bootstrap admin",
      scopes: ["chat", "models", "usage", "manage"],
    });
    console.log("[MiniRouter] bootstrap admin created");
    console.log(`[MiniRouter] bootstrap API key (save now): ${key.key}`);
  }
}

// ─── Start HTTP server ────────────────────────────────────────────────
const { serve } = await import("@hono/node-server");
const app = createApp();

serve(
  {
    fetch: app.fetch,
    port: PROXY_PORT,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`[MiniRouter] listening on http://localhost:${info.port}`);
    console.log(`[MiniRouter] dashboard: http://localhost:${info.port}/admin/dashboard`);
  },
);
