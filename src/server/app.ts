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
import type { Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  adminListUsers,
  adminGetUser,
  adminCreateKey,
  adminRevokeKey,
  adminUsage,
  adminStats,
} from "./routes/admin.js";
import { getUsageLogs, getUserUsageSummary } from "./routes/usage-logs.js";

function serveModelsDashboard(c: Context) {
  const html = readFileSync(resolve(process.cwd(), "models/dashboard.html"), "utf8");
  return c.html(html);
}

export function createApp(): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());
  app.use("*", logger());

  // ─── Public routes (no auth required) ───────────────────────────

  // Health check
  app.get("/health", health);
  app.get("/health/ready", readiness);

  // User registration (public in Phase 1, can be invite-only later)
  app.post("/admin/register", register);
  app.get("/api/models", listModelScores);
  app.get("/api/models/:id", getModelScore);
  app.get("/models/dashboard", serveModelsDashboard);
  app.get("/models/dashboard.html", serveModelsDashboard);
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
  api.get("/admin/users", adminListUsers);
  api.get("/admin/users/:id", adminGetUser);
  api.post("/admin/keys", adminCreateKey);
  api.delete("/admin/keys/:id", adminRevokeKey);
  api.get("/admin/usage", adminUsage);
  api.get("/admin/stats", adminStats);
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
