/**
 * Debug Logging Middleware
 *
 * Logs full request/response bodies for troubleshooting.
 * Controlled by env var: MINIROUTER_DEBUG_LOG=true
 *
 * Only logs POST requests to /v1/* routes.
 */

import type { Context, Next, MiddlewareHandler } from "hono";

function isEnabled(): boolean {
  return process.env["MINIROUTER_DEBUG_LOG"] === "true";
}

function truncate(text: string, maxChars: number = 4000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `... [truncated, ${text.length} total chars]`;
}

/**
 * Hono middleware — logs request/response bodies on matching routes.
 *
 * NOTE: This middleware must be placed BEFORE any middleware that reads the
 * request body, otherwise the body stream will be consumed and unreadable.
 */
export const debugLogMiddleware: MiddlewareHandler = async (c: Context, next: Next) => {
  if (!isEnabled()) {
    await next();
    return;
  }

  const path = c.req.path;
  const method = c.req.method;

  // Only log POST to /v1/*
  if (method !== "POST" || !path.startsWith("/v1/")) {
    await next();
    return;
  }

  // Read and log the request body
  const rawBody = await c.req.text();
  console.log(`[debug] ───────────────────────────────────────`);
  console.log(`[debug] IN  ${method} ${path}`);
  console.log(`[debug] body: ${truncate(rawBody)}`);

  // We need to re-wrap the request so downstream handlers can still read JSON
  // Hono caches the body text, so c.req.json() will re-parse it
  await next();

  // Log the response status
  const status = c.res?.status ?? "-";
  console.log(`[debug] OUT ${method} ${path} → ${status}`);
  console.log(`[debug] ───────────────────────────────────────`);
};

/**
 * Utility: log a body snapshot from a provider/route handler.
 * Usage:   debugLog("upstream-body", body);
 */
export function debugLog(label: string, body: unknown): void {
  if (!isEnabled()) return;
  console.log(`[debug] ${label}: ${truncate(JSON.stringify(body))}`);
}

/**
 * Utility: log an upstream response.
 */
export function debugLogResponse(label: string, status: number, bodyText: string): void {
  if (!isEnabled()) return;
  console.log(`[debug] UPSTREAM ${label} → ${status}: ${truncate(bodyText)}`);
}