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
import { debugLogMiddleware } from "./middleware/debug.js";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/ratelimit.js";
import { chatCompletions } from "./routes/chat.js";
import { anthropicMessages } from "./routes/anthropic-messages.js";
import { health, readiness } from "./routes/health.js";
import { listModels } from "./routes/models.js";
import { getModelScore, listModelScores, updateModelScore } from "./routes/models-api.js";
import { debugRoute } from "./routes/debug-route.js";
import {
  register,
  setup,
  adminVerify,
  adminOverview,
  adminListUsers,
  adminCreateUser,
  adminGetUser,
  adminUpdateUser,
  adminDeleteUser,
  adminListUserKeys,
  adminCreateUserKey,
  adminCreateKey,
  adminRevokeKey,
  adminUsage,
  adminStats,
  adminListChannels,
  adminCreateChannel,
  adminUpdateChannel,
  adminDeleteChannel,
} from "./routes/admin.js";
import { getUsageLogs, getUserUsageSummary } from "./routes/usage-logs.js";
import { serveAdminDashboard } from "./routes/admin-dashboard.js";

export function createApp(): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());
  app.use("*", logger());
  app.use("*", debugLogMiddleware);

  // ─── Public routes (no auth required) ───────────────────────────

  // Health check
  app.get("/health", health);
  app.get("/health/ready", readiness);

  // First-time setup (no auth required)
  app.post("/setup", setup);

  // Admin verify needs auth middleware, so it goes under the api group

  // User registration is authenticated under the admin router. Keep public
  // model APIs available for the model dashboard.
  app.get("/api/models", listModelScores);
  app.get("/api/models/:id", getModelScore);
  app.get("/admin/dashboard", serveAdminDashboard);
  app.get("/debug/route", debugRoute);
  app.post("/debug/route", debugRoute);

  // ─── Authenticated routes ────────────────────────────────────────

  const api = new Hono();
  api.use("*", authMiddleware);
  api.use("*", rateLimitMiddleware);

  // OpenAI-compatible endpoints
  api.post("/v1/chat/completions", chatCompletions);
  api.post("/v1/messages", anthropicMessages);
  api.get("/v1/models", listModels);

  // Admin endpoints
  api.post("/admin/register", register);
  api.get("/admin/verify", adminVerify);
  api.get("/admin/overview", adminOverview);
  api.get("/admin/users", adminListUsers);
  api.post("/admin/users", adminCreateUser);
  api.get("/admin/users/:id", adminGetUser);
  api.patch("/admin/users/:id", adminUpdateUser);
  api.delete("/admin/users/:id", adminDeleteUser);
  api.get("/admin/users/:id/keys", adminListUserKeys);
  api.post("/admin/users/:id/keys", adminCreateUserKey);
  api.post("/admin/keys", adminCreateKey);
  api.delete("/admin/keys/:id", adminRevokeKey);
  api.get("/admin/usage", adminUsage);
  api.get("/admin/stats", adminStats);
  api.get("/admin/channels", adminListChannels);
  api.post("/admin/channels", adminCreateChannel);
  api.patch("/admin/channels/:id", adminUpdateChannel);
  api.delete("/admin/channels/:id", adminDeleteChannel);
  api.put("/api/models/:id", updateModelScore);

  // Usage log query endpoints
  api.get("/api/usage/logs", getUsageLogs);
  api.get("/api/usage/summary", getUserUsageSummary);

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
