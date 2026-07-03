/**
 * Usage Log Query Routes
 *
 * GET /api/usage/logs - query per-request usage history
 * GET /api/usage/summary - aggregate usage stats (non-admin version)
 */

import type { Context } from "hono";
import type { AuthResult } from "../../auth/types.js";
import { getDb } from "../../db/connection.js";
import { usageLogs } from "../../db/schema.js";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

export interface UsageLogEntry {
  id: number;
  requestId: string;
  model: string;
  tier: string | null;
  profile: string | null;
  strategy: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  baselineCostUsd: number | null;
  savingsPct: number | null;
  latencyMs: number | null;
  firstTokenMs: number | null;
  status: string;
  errorType: string | null;
  isStreaming: boolean;
  hasTools: boolean;
  hasVision: boolean;
  createdAt: string;
}

export async function getUsageLogs(c: Context) {
  const auth = c.get("auth") as AuthResult;
  const db = getDb();

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 500);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const model = c.req.query("model");

  // Only admins can query other users' logs. Regular users can only query their own.
  const isAdmin = auth.role === "admin" || auth.role === "superadmin";
  const requestedUserId = c.req.query("user_id");

  if (!isAdmin && requestedUserId) {
    return c.json(
      {
        error: {
          message: "Only admins can query other users' logs",
          type: "authorization_error",
        },
      },
      403,
    );
  }

  const userId = requestedUserId ?? auth.userId;

  const conditions = [eq(usageLogs.userId, userId)];
  if (from) conditions.push(gte(usageLogs.createdAt, from));
  if (to) conditions.push(lte(usageLogs.createdAt, to));
  if (status) conditions.push(eq(usageLogs.status, status));
  if (model) conditions.push(eq(usageLogs.model, model));

  const rows = await db
    .select()
    .from(usageLogs)
    .where(and(...conditions))
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit)
    .offset(offset);

  const logs: UsageLogEntry[] = rows.map((r) => ({
    id: Number(r.id),
    requestId: r.requestId,
    model: r.model,
    tier: r.tier ?? null,
    profile: r.profile ?? null,
    strategy: r.strategy ?? null,
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    cacheReadTokens: Number(r.cacheReadTokens),
    costUsd: Number(r.costUsd),
    baselineCostUsd: r.baselineCostUsd != null ? Number(r.baselineCostUsd) : null,
    savingsPct: r.savingsPct != null ? Number(r.savingsPct) : null,
    latencyMs: r.latencyMs != null ? Number(r.latencyMs) : null,
    firstTokenMs: r.firstTokenMs != null ? Number(r.firstTokenMs) : null,
    status: r.status,
    errorType: r.errorType ?? null,
    isStreaming: !!r.isStreaming,
    hasTools: !!r.hasTools,
    hasVision: !!r.hasVision,
    createdAt: r.createdAt,
  }));

  return c.json({
    data: logs,
    count: logs.length,
    limit,
    offset,
  });
}

export async function getUserUsageSummary(c: Context) {
  const auth = c.get("auth") as AuthResult;
  const db = getDb();

  const from = c.req.query("from") ?? new Date(Date.now() - 86400000 * 30).toISOString();
  const to = c.req.query("to") ?? new Date().toISOString();

  const result = await db
    .select({
      totalRequests: sql<number>`COUNT(*)`,
      successfulRequests: sql<number>`COUNT(CASE WHEN ${usageLogs.status} = 'success' THEN 1 END)`,
      errorRequests: sql<number>`COUNT(CASE WHEN ${usageLogs.status} = 'error' THEN 1 END)`,
      totalCostUsd: sql<number>`COALESCE(SUM(${usageLogs.costUsd}), 0)`,
      totalInputTokens: sql<number>`COALESCE(SUM(${usageLogs.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${usageLogs.outputTokens}), 0)`,
      avgSavingsPct: sql<number>`COALESCE(AVG(${usageLogs.savingsPct}), 0)`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.userId, auth.userId),
        gte(usageLogs.createdAt, from),
        lte(usageLogs.createdAt, to),
      ),
    );

  // Breakdown by model
  const byModel = await db
    .select({
      model: usageLogs.model,
      requests: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${usageLogs.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${usageLogs.outputTokens}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${usageLogs.costUsd}), 0)`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.userId, auth.userId),
        gte(usageLogs.createdAt, from),
        lte(usageLogs.createdAt, to),
      ),
    )
    .groupBy(usageLogs.model);

  return c.json({
    ...{
      totalRequests: Number(result[0]?.totalRequests ?? 0),
      successfulRequests: Number(result[0]?.successfulRequests ?? 0),
      errorRequests: Number(result[0]?.errorRequests ?? 0),
      totalCostUsd: Number(result[0]?.totalCostUsd ?? 0),
      totalInputTokens: Number(result[0]?.totalInputTokens ?? 0),
      totalOutputTokens: Number(result[0]?.totalOutputTokens ?? 0),
      avgSavingsPct: Number(result[0]?.avgSavingsPct ?? 0),
    },
    byModel: byModel.map((r) => ({
      model: r.model,
      requests: Number(r.requests),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: Number(r.costUsd),
    })),
    period: { from, to },
  });
}