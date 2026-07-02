/**
 * MiniRouter Database Schema
 *
 * Drizzle ORM table definitions. Uses SQLite as default, PostgreSQL-ready.
 *
 * Tables:
 *   - users: User accounts with routing preferences and spend limits
 *   - api_keys: API key authentication (hash + encrypted full key)
 *   - usage_logs: Per-request usage tracking (append-mostly)
 *   - provider_instances: Model provider endpoints for load balancing
 *   - routing_configs: Per-user routing overrides
 *   - teams + team_members: Team/organization management (Phase 3)
 *   - sessions: Persistent session store for multi-turn pinning
 */

import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";

// ─── Users ────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // UUIDv7

  email: text("email").notNull().unique(),
  name: text("name"),

  // Routing preferences
  routingProfile: text("routing_profile").notNull().default("auto"), // eco | auto | premium
  routingStrategy: text("routing_strategy").notNull().default("rules"), // rules | cost_threshold
  defaultModel: text("default_model"), // optional pinned model override

  // Limits
  rateLimitRpm: integer("rate_limit_rpm").default(60),
  rateLimitRpd: integer("rate_limit_rpd").default(10000),
  spendLimitDailyUsd: real("spend_limit_daily_usd"), // NULL = unlimited
  spendLimitMonthlyUsd: real("spend_limit_monthly_usd"),

  // Status
  role: text("role").notNull().default("user"), // user | admin | superadmin
  isActive: integer("is_active").notNull().default(1), // boolean
  metadata: text("metadata"), // JSON blob for extensibility

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── API Keys ─────────────────────────────────────────────────────

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(), // UUIDv7

    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Key material: only hash is used for lookup; encrypted full key stored for recovery
    keyPrefix: text("key_prefix").notNull(), // First 12 chars for display ("mr_sk_a1b2")
    keyHash: text("key_hash").notNull().unique(), // SHA-256 of full key (used for auth)
    encryptedKey: text("encrypted_key"), // AES-256-GCM encrypted full key (at-rest)

    // Metadata
    name: text("name"), // User-given label ("production", "staging")
    scopes: text("scopes").notNull().default('["chat","models"]'), // JSON array

    // Overrides (override user defaults when set)
    rateLimitRpmOverride: integer("rate_limit_rpm_override"),
    spendLimitDailyOverrideUsd: real("spend_limit_daily_override_usd"),

    // Lifecycle
    lastUsedAt: text("last_used_at"),
    expiresAt: text("expires_at"), // NULL = never expires
    isActive: integer("is_active").notNull().default(1),

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_api_keys_user_id").on(table.userId),
    index("idx_api_keys_key_hash").on(table.keyHash),
    index("idx_api_keys_key_prefix").on(table.keyPrefix),
  ],
);

// ─── Usage Logs ────────────────────────────────────────────────────

export const usageLogs = sqliteTable(
  "usage_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    apiKeyId: text("api_key_id").references(() => apiKeys.id),

    // Request
    requestId: text("request_id").notNull(), // UUID per request for dedup
    model: text("model").notNull(), // Actual model used
    tier: text("tier"), // SIMPLE | MEDIUM | COMPLEX | REASONING
    profile: text("profile"), // eco | auto | premium
    strategy: text("strategy"), // rules | cost_threshold

    // Tokens
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    cacheReadTokens: integer("cache_read_tokens").default(0),

    // Cost
    costUsd: real("cost_usd").notNull(),
    baselineCostUsd: real("baseline_cost_usd"), // What Claude Opus would have cost
    savingsPct: real("savings_pct"), // 0.0-1.0

    // Performance
    latencyMs: integer("latency_ms"),
    firstTokenMs: integer("first_token_ms"),

    // Status
    status: text("status").notNull().default("success"), // success | error | rate_limited
    errorType: text("error_type"),

    // Context
    isStreaming: integer("is_streaming").default(0), // boolean
    hasTools: integer("has_tools").default(0),
    hasVision: integer("has_vision").default(0),

    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_usage_user_id").on(table.userId, table.createdAt),
    index("idx_usage_created_at").on(table.createdAt),
  ],
);

// ─── Provider Instances ───────────────────────────────────────────

export const providerInstances = sqliteTable("provider_instances", {
  id: text("id").primaryKey(),

  modelId: text("model_id").notNull(), // e.g. "google/gemini-2.5-flash"
  provider: text("provider").notNull(), // e.g. "blockrun", "openai-direct"
  endpointUrl: text("endpoint_url").notNull(),
  weight: real("weight").notNull().default(1.0),

  // Health
  isHealthy: integer("is_healthy").notNull().default(1),
  lastHealthCheck: text("last_health_check"),
  consecutiveFailures: integer("consecutive_failures").default(0),

  // Performance
  avgLatencyMs: real("avg_latency_ms"),
  p95LatencyMs: real("p95_latency_ms"),
  errorRate: real("error_rate"),

  createdAt: text("created_at").notNull(),
});

// ─── Routing Configs ──────────────────────────────────────────────

export const routingConfigs = sqliteTable(
  "routing_configs",
  {
    id: text("id").primaryKey(),

    userId: text("user_id").references(() => users.id), // NULL = global default
    teamId: text("team_id"), // NULL = not team-scoped (Phase 3)

    // Partial RoutingConfig JSON
    configJson: text("config_json").notNull(),

    // Priority: user > team > global default
    priority: integer("priority").notNull().default(0),

    isActive: integer("is_active").notNull().default(1),

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_routing_config_user").on(table.userId)],
);

// ─── Teams (Phase 3) ──────────────────────────────────────────────

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  spendLimitMonthlyUsd: real("spend_limit_monthly_usd"),
  createdAt: text("created_at").notNull(),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // admin | member
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);

// ─── Model Scorecard ──────────────────────────────────────────────

/**
 * 模型能力与价格评分卡 — 路由引擎的数据底座。
 * 每个模型一行，包含价格、多维能力评分、多模态支持、OpenRouter 热度等。
 */
export const modelScores = sqliteTable(
  "model_scores",
  {
    id: text("id").primaryKey(), // "deepseek/v4-flash"
    provider: text("provider").notNull(), // "DeepSeek"
    displayName: text("display_name").notNull(), // "DeepSeek V4 Flash"
    tier: text("tier").notNull().default("candidate"), // starter | pro | promax | candidate | deprecated

    // 价格 (元/百万 token)
    priceInput: real("price_input").notNull(),
    priceOutput: real("price_output").notNull(),
    priceCacheHit: real("price_cache_hit"), // NULL = 不支持缓存
    peakMultiplier: real("peak_multiplier"), // 峰谷定价倍数
    peakHours: text("peak_hours"), // "工作日 9:00-12:00, 14:00-18:00"
    tokenPlan: text("token_plan"), // 套餐说明

    // 能力评分 (0-100)
    scoreCoding: integer("score_coding").default(0),
    scoreReasoning: integer("score_reasoning").default(0),
    scoreChinese: integer("score_chinese").default(0),
    scoreCreative: integer("score_creative").default(0),
    scoreSpeed: integer("score_speed").default(0),
    scoreOverall: integer("score_overall").default(0),

    // 多模态 (0/1)
    hasVision: integer("has_vision").default(0),
    hasVideo: integer("has_video").default(0),
    hasAudio: integer("has_audio").default(0),

    // 技术参数
    contextWindow: integer("context_window"),
    maxOutput: integer("max_output"),
    supportsTools: integer("supports_tools").default(0),
    supportsJson: integer("supports_json").default(0),

    // OpenRouter 热度
    orRank: integer("or_rank"), // 本周排名
    orWeeklyVolume: text("or_weekly_volume"), // "4.88T tokens"
    orWeeklyChange: text("or_weekly_change"), // "+32%"

    // 运营
    isActive: integer("is_active").default(1),
    priority: integer("priority").default(0),
    releaseDate: text("release_date"),
    notes: text("notes"),
    verified: integer("verified").default(0), // 1=官方确认, 0=估算

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_model_tier").on(table.tier),
    index("idx_model_provider").on(table.provider),
    index("idx_model_active").on(table.isActive),
  ],
);
