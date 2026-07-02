/**
 * MiniRouter Server — Hono App Entry Point
 *
 * Standalone HTTP API server for the multi-user auto-routing platform.
 * Provides OpenAI-compatible endpoints with API key authentication.
 *
 * Usage:
 *   import { createApp } from "./server/app.js";
 *   const app = createApp();
 *   serve({ fetch: app.fetch, port: 8402 });
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/ratelimit.js";
import { chatCompletions } from "./routes/chat.js";
import { listModels } from "./routes/models.js";
import {
  register,
  adminListUsers,
  adminGetUser,
  adminCreateKey,
  adminRevokeKey,
  adminUsage,
  adminStats,
} from "./routes/admin.js";

export function createApp(): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());
  app.use("*", logger());

  // ─── Public routes (no auth required) ───────────────────────────

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));
  app.get("/health/ready", (c) => {
    // In Phase 2, check DB connectivity
    return c.json({ status: "ready", timestamp: new Date().toISOString() });
  });

  // User registration (public in Phase 1, can be invite-only later)
  app.post("/admin/register", register);

  // ─── Authenticated routes ────────────────────────────────────────

  const api = new Hono();
  api.use("*", authMiddleware);
  api.use("*", rateLimitMiddleware);

  // OpenAI-compatible endpoints
  api.post("/v1/chat/completions", chatCompletions);
  api.get("/v1/models", listModels);

  // Admin endpoints
  api.get("/admin/users", adminListUsers);
  api.get("/admin/users/:id", adminGetUser);
  api.post("/admin/keys", adminCreateKey);
  api.delete("/admin/keys/:id", adminRevokeKey);
  api.get("/admin/usage", adminUsage);
  api.get("/admin/stats", adminStats);

  app.route("/", api);

  // ─── Error handling ──────────────────────────────────────────────

  app.onError((err, c) => {
    console.error("[MiniRouter] Server error:", err);
    return c.json(
      {
        error: {
          message: err.message ?? "Internal server error",
          type: "server_error",
        },
      },
      500,
    );
  });

  // ─── 404 handler ──────────────────────────────────────────────────

  app.notFound((c) => {
    return c.json(
      {
        error: {
          message: `Not found: ${c.req.method} ${c.req.path}`,
          type: "not_found",
        },
      },
      404,
    );
  });

  return app;
}
