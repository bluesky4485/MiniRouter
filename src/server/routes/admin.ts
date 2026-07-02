/**
 * Admin API Routes
 *
 * User management, API key management, usage stats.
 * All routes require admin or superadmin role.
 */

import type { Context } from "hono";
import type { AuthResult } from "../../auth/types.js";
import { createUser, getUserById, getUserByEmail, listUsers } from "../../db/queries/users.js";
import { createApiKey, revokeApiKey } from "../../auth/apikey.js";
import { getUserUsageStats } from "../../db/queries/usage.js";

// ─── Middleware ──────────────────────────────────────────────────────

function requireAdmin(c: Context): AuthResult {
  const auth = c.get("auth") as AuthResult;
  if (!auth || !auth.role || (auth.role !== "admin" && auth.role !== "superadmin")) {
    // Throw a Response object — Hono catches it via onError
    const response = c.json(
      { error: { message: "Admin access required", type: "authorization_error" } },
      403,
    );
    throw response;
  }
  return auth;
}

// ─── POST /admin/register ──────────────────────────────────────────

export async function register(c: Context) {
  const { email, name } = await c.req.json();

  if (!email || typeof email !== "string") {
    return c.json({ error: { message: "Email is required", type: "invalid_request" } }, 400);
  }

  // Check if user already exists
  const existing = await getUserByEmail(email);
  if (existing) {
    return c.json({ error: { message: "User already exists", type: "duplicate" } }, 409);
  }

  const user = await createUser({ email, name });
  const key = await createApiKey({ userId: user.id, name: "Default" });

  return c.json(
    {
      user_id: user.id,
      email: user.email,
      name: user.name,
      api_key: key.key,
      message: "Save this API key — it will not be shown again.",
    },
    201,
  );
}

// ─── GET /admin/users ──────────────────────────────────────────────

export async function adminListUsers(c: Context) {
  requireAdmin(c);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 500);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const users = await listUsers(limit, offset);
  return c.json({ data: users });
}

// ─── GET /admin/users/:id ──────────────────────────────────────────

export async function adminGetUser(c: Context) {
  requireAdmin(c);
  const id = c.req.param("id")!;
  if (!id) return c.json({ error: { message: "User ID is required" } }, 400);
  const user = await getUserById(id);
  if (!user) return c.json({ error: { message: "User not found" } }, 404);
  return c.json(user);
}

// ─── POST /admin/keys ───────────────────────────────────────────────

export async function adminCreateKey(c: Context) {
  requireAdmin(c);
  const body = await c.req.json();
  const userId: string | undefined = body.user_id ?? body.userId;

  if (!userId) {
    return c.json({ error: { message: "user_id is required" } }, 400);
  }

  const user = await getUserById(userId);
  if (!user) {
    return c.json({ error: { message: "User not found" } }, 404);
  }

  const key = await createApiKey({
    userId,
    name: body.name,
    scopes: body.scopes,
    expiresInDays: body.expires_in_days,
  });

  return c.json(
    {
      id: key.id,
      key: key.key,
      name: key.name,
      scopes: key.scopes,
      expires_at: key.expiresAt,
      created_at: key.createdAt,
    },
    201,
  );
}

// ─── DELETE /admin/keys/:id ─────────────────────────────────────────

export async function adminRevokeKey(c: Context) {
  requireAdmin(c);
  const id = c.req.param("id")!;
  await revokeApiKey(id);
  return c.json({ status: "revoked", key_id: id });
}

// ─── GET /admin/usage ───────────────────────────────────────────────

export async function adminUsage(c: Context) {
  requireAdmin(c);
  const userId = c.req.query("user_id");
  const from = c.req.query("from") ?? new Date(Date.now() - 86400000 * 30).toISOString();
  const to = c.req.query("to") ?? new Date().toISOString();

  if (!userId) {
    return c.json({ error: { message: "user_id query parameter required" } }, 400);
  }

  const stats = await getUserUsageStats(userId, from, to);
  return c.json(stats);
}

// ─── GET /admin/stats ───────────────────────────────────────────────

export async function adminStats(c: Context) {
  requireAdmin(c);
  // Phase 1: placeholder — will be enhanced with real aggregation queries
  return c.json({
    timestamp: new Date().toISOString(),
    note: "Stats endpoint will be enhanced in Phase 2 with platform-wide aggregation",
    status: "operational",
  });
}
