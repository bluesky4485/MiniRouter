/**
 * Auth Provider Types
 *
 * Pluggable authentication system. Each provider handles a different
 * authentication method (API key, wallet, admin master key).
 */

/**
 * Result of a successful authentication.
 */
export interface AuthResult {
  userId: string;
  apiKeyId?: string;
  scopes: string[];
  routingProfile: string;
  role?: string;
  method: "apikey" | "wallet" | "admin";
  metadata?: Record<string, unknown>;
}

/**
 * Interface for authentication providers.
 */
export interface AuthProvider {
  readonly name: string;

  /**
   * Authenticate a request. Returns AuthResult on success, null if not applicable
   * (provider doesn't handle this request format), or throws on invalid credentials.
   */
  authenticate(request: AuthRequest): Promise<AuthResult | null>;
}

/**
 * Minimal request context needed by auth providers.
 */
export interface AuthRequest {
  headers: Record<string, string | undefined>;
  /** Raw URL path for scope matching */
  path: string;
  /** HTTP method */
  method: string;
}

/**
 * Options for generating a new API key.
 */
export interface GenerateKeyOptions {
  userId: string;
  name?: string;
  scopes?: string[];
  expiresInDays?: number;
  rateLimitRpmOverride?: number;
  spendLimitDailyOverrideUsd?: number;
}

/**
 * Result of key generation — the full key is only returned once.
 */
export interface GeneratedKey {
  id: string;
  key: string; // Full key in "mr_sk_xxxx" format — shown only once
  keyPrefix: string;
  name: string | null;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}
