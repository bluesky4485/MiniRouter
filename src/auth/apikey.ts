/**
 * API Key Authentication
 *
 * Generates, hashes, and validates API keys for the multi-user system.
 *
 * Key format: mr_sk_<96 hex chars> (48 random bytes, 384 bits entropy)
 * - Prefix "mr_sk_" identifies MiniRouter secret keys
 * - 48 bytes of cryptographically random data
 * - Displayed as first 12 chars prefix for identification
 * - Stored as SHA-256 hash for lookup
 * - Optional AES-256-GCM encrypted storage for key recovery
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "../db/connection.js";
import { apiKeys, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { v7 as uuidv7 } from "./uuid.js";
import type { AuthProvider, AuthRequest, AuthResult, GenerateKeyOptions, GeneratedKey } from "./types.js";

const KEY_PREFIX = "mr_sk_";
const KEY_BYTES = 48; // 48 random bytes = 96 hex chars
const DISPLAY_PREFIX_LEN = 12; // "mr_sk_" + 6 hex chars for display

/**
 * Generate a cryptographically random API key in "mr_sk_xxx" format.
 */
export function generateApiKey(): string {
  const bytes = randomBytes(KEY_BYTES);
  const hex = bytes.toString("hex");
  return `${KEY_PREFIX}${hex}`;
}

/**
 * Hash an API key with SHA-256 for secure storage and lookup.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Extract the display prefix from a full key.
 * e.g. "mr_sk_a1b2c3d4..." -> "mr_sk_a1b2c3"
 */
export function keyDisplayPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LEN);
}

/**
 * Constant-time comparison of two API key hashes.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Create a new API key for a user.
 * The full key is only returned once — the caller must present it to the user.
 */
export async function createApiKey(opts: GenerateKeyOptions): Promise<GeneratedKey> {
  const db = getDb();
  const id = uuidv7();
  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const keyPrefix = keyDisplayPrefix(key);
  const now = new Date().toISOString();

  const expiresAt = opts.expiresInDays
    ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString()
    : null;

  await db.insert(apiKeys).values({
    id,
    userId: opts.userId,
    keyPrefix,
    keyHash,
    name: opts.name ?? null,
    scopes: JSON.stringify(opts.scopes ?? ["chat", "models"]),
    rateLimitRpmOverride: opts.rateLimitRpmOverride ?? null,
    spendLimitDailyOverrideUsd: opts.spendLimitDailyOverrideUsd ?? null,
    expiresAt,
    isActive: 1,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    key,
    keyPrefix,
    name: opts.name ?? null,
    scopes: opts.scopes ?? ["chat", "models"],
    expiresAt,
    createdAt: now,
  };
}

/**
 * Revoke (deactivate) an API key.
 */
export async function revokeApiKey(keyId: string): Promise<void> {
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ isActive: 0, updatedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, keyId));
}

/**
 * API Key Authentication Provider.
 *
 * Extracts the API key from the Authorization header (Bearer token),
 * validates it against the database, and returns the user context.
 */
export class ApiKeyAuthProvider implements AuthProvider {
  readonly name = "apikey";

  async authenticate(request: AuthRequest): Promise<AuthResult | null> {
    const key = this.extractKey(request.headers);
    if (!key) return null; // Not an API key request — let other providers try

    const keyHash = hashApiKey(key);
    const db = getDb();

    // Lookup by hash
    const result = await db
      .select({
        apiKeyId: apiKeys.id,
        keyHash: apiKeys.keyHash,
        scopes: apiKeys.scopes,
        isActive: apiKeys.isActive,
        expiresAt: apiKeys.expiresAt,
        userId: users.id,
        routingProfile: users.routingProfile,
        userIsActive: users.isActive,
        userRole: users.role,
      })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.userId, users.id))
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, 1)))
      .limit(1);

    const record = result[0];
    if (!record) {
      throw new AuthError("Invalid API key", 401);
    }

    // Check user is active
    if (!record.userIsActive) {
      throw new AuthError("Account is disabled", 403);
    }

    // Check expiration
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      throw new AuthError("API key has expired", 401);
    }

    // Update last_used_at
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.id, record.apiKeyId));

    return {
      userId: record.userId,
      apiKeyId: record.apiKeyId,
      scopes: JSON.parse(record.scopes),
      routingProfile: record.routingProfile,
      role: record.userRole,
      method: "apikey",
    };
  }

  /**
   * Extract API key from request headers.
   * Supports: Authorization: Bearer mr_sk_xxxx
   */
  private extractKey(headers: Record<string, string | undefined>): string | null {
    const auth = headers["authorization"];
    if (!auth) return null;

    // "Bearer mr_sk_xxxx"
    const match = auth.match(/^Bearer\s+(mr_sk_[a-f0-9]+)$/i);
    if (match) return match[1];

    // Also support "mr_sk_xxxx" directly (no Bearer prefix) for x-api-key header
    if (auth.startsWith("mr_sk_") && /^mr_sk_[a-f0-9]+$/.test(auth)) {
      return auth;
    }

    return null;
  }
}

/**
 * Authentication error with HTTP status code.
 */
export class AuthError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}
