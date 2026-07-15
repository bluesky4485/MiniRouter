/**
 * Admin API routes for users, keys, usage, and provider channels.
 */

import type { Context } from "hono";
import type { AuthResult } from "../../auth/types.js";
import { createApiKey, listApiKeysForUser, revokeApiKey } from "../../auth/apikey.js";
import { getPlatformOverview } from "../../db/queries/spend.js";
import { getUserUsageStats } from "../../db/queries/usage.js";
import { createUser, deleteUser, getUserByEmail, getUserById, listUsers, updateUser } from "../../db/queries/users.js";
import {
  createProviderInstance,
  disableProviderInstance,
  listProviderInstances,
  updateProviderInstance,
} from "../../db/queries/provider-instances.js";
import type { ProviderChannel } from "../../providers/channels.js";
import type { ModelSlotName } from "../../providers/types.js";
import { getDb } from "../../db/connection.js";
import { users } from "../../db/schema.js";
import { sql } from "drizzle-orm";

type CreateKeyRequest = {
  name?: string;
  scopes?: string[];
  expires_in_days?: number;
  expiresInDays?: number;
  rateLimitRpmOverride?: number;
  spendLimitDailyOverrideUsd?: number;
};

/**
 * POST /setup — First-time admin registration.
 *
 * Creates the first admin user + an API key. Only works if no users exist yet.
 * Returns the API key once; must be saved by the caller.
 */
export async function setup(c: Context) {
  const db = getDb();
  const existing = await db.select({ count: sql<number>`COUNT(*)` }).from(users).where(sql`id != 'solo'`);
  if (Number(existing[0]?.count ?? 0) > 0) {
    return c.json({ error: { message: "Setup already completed. An admin user already exists.", type: "setup_complete" } }, 409);
  }

  const body = await c.req.json();
  const email = body.email || "admin@minirouter.local";
  const name = body.name || "Admin";

  const user = await createUser({
    email,
    name,
    role: "superadmin",
    routingProfile: "auto",
  });

  const key = await createApiKey({ userId: user.id, name: "Admin", scopes: ["chat", "models", "usage", "manage"] });

  return c.json({
    user_id: user.id,
    email: user.email,
    name: user.name,
    api_key: key.key,
    key_prefix: key.keyPrefix,
    message: "Save this API key; it will not be shown again.",
  }, 201);
}

/**
 * POST /admin/verify — Validate an admin API key.
 *
 * Returns the user info + scopes if the key is valid and has manage scope.
 */
export async function adminVerify(c: Context) {
  const auth = c.get("auth") as AuthResult;
  if (!auth) {
    return c.json({ error: { message: "No valid API key provided.", type: "authentication_error" } }, 401);
  }
  const isAdminRole = auth.role === "admin" || auth.role === "superadmin";
  const hasManageScope = auth.scopes?.includes("manage");
  if (!isAdminRole || !hasManageScope) {
    return c.json({ error: { message: "Admin manage access required", type: "authorization_error" } }, 403);
  }
  return c.json({
    user_id: auth.userId,
    role: auth.role,
    scopes: auth.scopes,
  });
}

function requireAdmin(c: Context): AuthResult {
  const auth = c.get("auth") as AuthResult;
  const isAdminRole = auth?.role === "admin" || auth?.role === "superadmin";
  const hasManageScope = auth?.scopes?.includes("manage");
  if (!auth || !isAdminRole || !hasManageScope) {
    throw c.json(
      { error: { message: "Admin manage access required", type: "authorization_error" } },
      403,
    );
  }
  return auth;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number") return undefined;
  return Number.isFinite(value) ? value : undefined;
}

function publicChannel(channel: ProviderChannel) {
  const { apiKey, ...safe } = channel;
  void apiKey;
  return safe;
}

async function createUserWithOptionalDefaultKey(c: Context, createDefaultKey: boolean) {
  const body = await c.req.json();
  if (!body.email || typeof body.email !== "string") {
    return c.json({ error: { message: "email is required", type: "invalid_request" } }, 400);
  }

  const existing = await getUserByEmail(body.email);
  if (existing) {
    return c.json({ error: { message: "User already exists", type: "duplicate" } }, 409);
  }

  const user = await createUser({
    email: body.email,
    name: typeof body.name === "string" ? body.name : undefined,
    routingProfile: body.routingProfile,
    role: body.role,
    rateLimitRpm: asNumberOrNull(body.rateLimitRpm) ?? undefined,
    rateLimitRpd: asNumberOrNull(body.rateLimitRpd) ?? undefined,
    spendLimitDailyUsd: asNumberOrNull(body.spendLimitDailyUsd),
    spendLimitMonthlyUsd: asNumberOrNull(body.spendLimitMonthlyUsd),
  });

  if (!createDefaultKey) return c.json(user, 201);

  const key = await createApiKey({ userId: user.id, name: "Default" });
  return c.json(
    {
      user_id: user.id,
      email: user.email,
      name: user.name,
      api_key: key.key,
      message: "Save this API key; it will not be shown again.",
    },
    201,
  );
}

export async function register(c: Context) {
  return createUserWithOptionalDefaultKey(c, true);
}

export async function adminOverview(c: Context) {
  requireAdmin(c);
  return c.json(await getPlatformOverview());
}

export async function adminStats(c: Context) {
  requireAdmin(c);
  return c.json(await getPlatformOverview());
}

export async function adminListUsers(c: Context) {
  requireAdmin(c);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 500);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const rows = await listUsers(limit, offset);
  return c.json({ data: rows });
}

export async function adminCreateUser(c: Context) {
  requireAdmin(c);
  return createUserWithOptionalDefaultKey(c, false);
}

export async function adminGetUser(c: Context) {
  requireAdmin(c);
  const id = c.req.param("id")!;
  const user = await getUserById(id);
  if (!user) return c.json({ error: { message: "User not found" } }, 404);
  return c.json(user);
}

export async function adminUpdateUser(c: Context) {
  requireAdmin(c);
  const id = c.req.param("id")!;
  const body = await c.req.json();
  const user = await updateUser(id, {
    name: typeof body.name === "string" || body.name === null ? body.name : undefined,
    routingProfile: body.routingProfile,
    role: body.role,
    isActive: asBool(body.isActive),
    rateLimitRpm: asNumberOrNull(body.rateLimitRpm),
    rateLimitRpd: asNumberOrNull(body.rateLimitRpd),
    spendLimitDailyUsd: asNumberOrNull(body.spendLimitDailyUsd),
    spendLimitMonthlyUsd: asNumberOrNull(body.spendLimitMonthlyUsd),
  });
  if (!user) return c.json({ error: { message: "User not found" } }, 404);
  return c.json(user);
}

export async function adminDeleteUser(c: Context) {
  requireAdmin(c);
  const id = c.req.param("id")!;
  const user = await getUserById(id);
  if (!user) return c.json({ error: { message: "User not found" } }, 404);
  if (user.role === "superadmin") {
    return c.json({ error: { message: "Cannot delete a superadmin user" } }, 403);
  }
  await deleteUser(id);
  return c.json({ status: "deleted", user_id: id });
}

export async function adminListUserKeys(c: Context) {
  requireAdmin(c);
  const userId = c.req.param("id")!;
  const user = await getUserById(userId);
  if (!user) return c.json({ error: { message: "User not found" } }, 404);
  return c.json({ data: await listApiKeysForUser(userId) });
}

export async function adminCreateKey(c: Context) {
  requireAdmin(c);
  const body = await c.req.json();
  const userId: string | undefined = body.user_id ?? body.userId;
  if (!userId) return c.json({ error: { message: "user_id is required" } }, 400);
  return createKeyForUser(c, userId, body);
}

export async function adminCreateUserKey(c: Context) {
  requireAdmin(c);
  return createKeyForUser(c, c.req.param("id")!, await c.req.json());
}

async function createKeyForUser(c: Context, userId: string, body: CreateKeyRequest) {
  const user = await getUserById(userId);
  if (!user) return c.json({ error: { message: "User not found" } }, 404);

  const key = await createApiKey({
    userId,
    name: body.name,
    scopes: body.scopes,
    expiresInDays: body.expires_in_days ?? body.expiresInDays,
    rateLimitRpmOverride: body.rateLimitRpmOverride,
    spendLimitDailyOverrideUsd: body.spendLimitDailyOverrideUsd,
  });

  return c.json(
    {
      id: key.id,
      key: key.key,
      key_prefix: key.keyPrefix,
      name: key.name,
      scopes: key.scopes,
      expires_at: key.expiresAt,
      created_at: key.createdAt,
    },
    201,
  );
}

export async function adminRevokeKey(c: Context) {
  requireAdmin(c);
  const id = c.req.param("id")!;
  await revokeApiKey(id);
  return c.json({ status: "revoked", key_id: id });
}

export async function adminUsage(c: Context) {
  requireAdmin(c);
  const userId = c.req.query("user_id");
  const from = c.req.query("from") ?? new Date(Date.now() - 86400000 * 30).toISOString();
  const to = c.req.query("to") ?? new Date().toISOString();
  if (!userId) return c.json({ error: { message: "user_id query parameter required" } }, 400);
  return c.json(await getUserUsageStats(userId, from, to));
}

export async function adminListChannels(c: Context) {
  requireAdmin(c);
  const channels = await listProviderInstances(c.req.query("slot") as ModelSlotName | undefined);
  return c.json({ data: channels.map(publicChannel) });
}

export async function adminCreateChannel(c: Context) {
  requireAdmin(c);
  const body = await c.req.json();
  for (const field of ["slot", "provider", "providerKind", "endpointUrl", "apiKey", "modelId"]) {
    if (!body[field]) {
      return c.json({ error: { message: `${field} is required`, type: "invalid_request" } }, 400);
    }
  }

  const channel = await createProviderInstance({
    slot: body.slot,
    provider: body.provider,
    providerKind: body.providerKind,
    endpointUrl: body.endpointUrl,
    apiKey: body.apiKey,
    modelId: body.modelId,
    pricingModelId: body.pricingModelId,
    weight: body.weight,
    supportsTools: body.supportsTools,
    supportsVision: body.supportsVision,
    contextWindowTokens: body.contextWindowTokens,
    notes: body.notes,
  });
  return c.json(publicChannel(channel), 201);
}

export async function adminUpdateChannel(c: Context) {
  requireAdmin(c);
  const channel = await updateProviderInstance(c.req.param("id")!, await c.req.json());
  if (!channel) return c.json({ error: { message: "Channel not found" } }, 404);
  return c.json(publicChannel(channel));
}

export async function adminDisableChannel(c: Context) {
  requireAdmin(c);
  const id = c.req.param("id")!;
  await disableProviderInstance(id);
  return c.json({ status: "disabled", channel_id: id });
}
