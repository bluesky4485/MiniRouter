/**
 * API Key Authentication Middleware
 *
 * Hono middleware that authenticates requests using the API key auth provider.
 * Falls back to solo (wallet) mode if no API key is present and solo mode is enabled.
 */

import type { Context, Next } from "hono";
import { ApiKeyAuthProvider, AuthError } from "../../auth/apikey.js";
import type { AuthResult } from "../../auth/types.js";

const apiKeyProvider = new ApiKeyAuthProvider();

/**
 * Hono middleware: authenticate via API key.
 * Attaches `auth` to the request context on success.
 */
export async function authMiddleware(c: Context, next: Next) {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(c.req.header())) {
    headers[key.toLowerCase()] = value;
  }

  try {
    const result = await apiKeyProvider.authenticate({
      headers,
      path: c.req.path,
      method: c.req.method,
    });

    if (result) {
      c.set("auth", result);
      return await next();
    }

    // No API key found — try solo mode
    return soloAuth(c, next);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json(
        { error: { message: err.message, type: "authentication_error" } },
        err.statusCode as 401 | 403,
      );
    }
    throw err;
  }
}

/**
 * Solo mode: when MINIROUTER_SOLO=true and no API key, use the wallet auth
 * with a virtual "solo" user. This preserves backward compatibility.
 */
async function soloAuth(c: Context, next: Next): Promise<Response> {
  const soloMode = process.env["MINIROUTER_SOLO"] === "true";
  if (!soloMode) {
    return c.json(
      {
        error: {
          message:
            "Authentication required. Provide an API key via Authorization: Bearer mr_sk_xxxx",
          type: "authentication_error",
        },
      },
      401,
    );
  }

  // Solo mode: create a virtual user context using wallet auth
  const soloAuth: AuthResult = {
    userId: "solo",
    scopes: ["chat", "models", "usage", "manage"],
    routingProfile: "auto",
    role: "superadmin",
    method: "wallet",
  };

  c.set("auth", soloAuth);
  const response = await next();
  return response as unknown as Response;
}

// Extend Hono's Context type to include auth
declare module "hono" {
  interface ContextVariableMap {
    auth: AuthResult;
  }
}
