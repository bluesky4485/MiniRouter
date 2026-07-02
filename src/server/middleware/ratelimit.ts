/**
 * Rate Limiting Middleware
 *
 * In-memory sliding window rate limiter per API key / user.
 * Uses a simple token bucket algorithm with per-minute limits.
 */

import type { Context, Next } from "hono";
import type { AuthResult } from "../../auth/types.js";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory store: keyId/userId → RateLimitEntry
const store = new Map<string, RateLimitEntry>();

// Default limits
const DEFAULT_RPM = 60; // requests per minute
const WINDOW_MS = 60_000; // 1 minute window

// Periodic cleanup (every 5 minutes, remove expired entries)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}, 300_000).unref();

/**
 * Hono middleware: rate limit requests per API key.
 * Uses the userId from the auth context as the rate limit key.
 */
export async function rateLimitMiddleware(c: Context, next: Next) {
  const auth = c.get("auth") as AuthResult | undefined;

  // Skip rate limiting for admin requests
  if (auth?.method === "admin") {
    return await next();
  }

  const key = auth?.apiKeyId ?? auth?.userId ?? "anonymous";
  const now = Date.now();

  let entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // New window
    entry = { count: 1, windowStart: now };
    store.set(key, entry);
    return await next();
  }

  const rpmLimit = DEFAULT_RPM; // Could be loaded from user/key config
  if (entry.count >= rpmLimit) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    c.header("Retry-After", String(retryAfter));
    return c.json(
      {
        error: {
          message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
          type: "rate_limit_exceeded",
        },
      },
      429,
    );
  }

  entry.count++;
  return await next();
}

/**
 * Reset all rate limit state (for testing).
 */
export function resetRateLimits(): void {
  store.clear();
}
