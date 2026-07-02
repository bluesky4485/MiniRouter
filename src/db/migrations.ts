/**
 * Database Migrations
 *
 * Creates tables on first run using Drizzle's schema definitions.
 * In the future this can be replaced with proper Drizzle Kit migrations.
 */

import { getDb } from "./connection.js";
import { sql } from "drizzle-orm";

/**
 * Run all pending migrations. Currently creates tables if they don't exist.
 * Idempotent — safe to call on every server start.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();

  // Enable WAL mode and foreign keys
  db.run(sql`PRAGMA journal_mode = WAL`);
  db.run(sql`PRAGMA foreign_keys = ON`);

  // Create tables using raw SQL for idempotency (IF NOT EXISTS)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      routing_profile TEXT NOT NULL DEFAULT 'auto',
      routing_strategy TEXT NOT NULL DEFAULT 'rules',
      default_model TEXT,
      rate_limit_rpm INTEGER DEFAULT 60,
      rate_limit_rpd INTEGER DEFAULT 10000,
      spend_limit_daily_usd REAL,
      spend_limit_monthly_usd REAL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_prefix TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      encrypted_key TEXT,
      name TEXT,
      scopes TEXT NOT NULL DEFAULT '["chat","models"]',
      rate_limit_rpm_override INTEGER,
      spend_limit_daily_override_usd REAL,
      last_used_at TEXT,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      api_key_id TEXT REFERENCES api_keys(id),
      request_id TEXT NOT NULL,
      model TEXT NOT NULL,
      tier TEXT,
      profile TEXT,
      strategy TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cost_usd REAL NOT NULL,
      baseline_cost_usd REAL,
      savings_pct REAL,
      latency_ms INTEGER,
      first_token_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'success',
      error_type TEXT,
      is_streaming INTEGER DEFAULT 0,
      has_tools INTEGER DEFAULT 0,
      has_vision INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage_logs(user_id, created_at)
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_logs(created_at)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS provider_instances (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      is_healthy INTEGER NOT NULL DEFAULT 1,
      last_health_check TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      avg_latency_ms REAL,
      p95_latency_ms REAL,
      error_rate REAL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS routing_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      team_id TEXT,
      config_json TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_routing_config_user ON routing_configs(user_id)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      model TEXT NOT NULL,
      tier TEXT NOT NULL,
      user_explicit INTEGER DEFAULT 0,
      request_count INTEGER DEFAULT 1,
      strikes INTEGER DEFAULT 0,
      escalated INTEGER DEFAULT 0,
      session_cost_micros INTEGER DEFAULT 0,
      recent_hashes TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, last_used_at)
  `);

  // ─── Model Scorecard ──────────────────────────────────────────────
  db.run(sql`
    CREATE TABLE IF NOT EXISTS model_scores (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'domestic',
      price_input REAL,
      price_output REAL,
      price_cache_hit REAL,
      peak_multiplier REAL,
      peak_hours TEXT,
      token_plan TEXT,
      score_coding INTEGER,
      score_reasoning INTEGER,
      score_chinese INTEGER,
      score_creative INTEGER,
      score_speed INTEGER,
      score_overall INTEGER,
      has_vision INTEGER DEFAULT 0,
      has_video INTEGER DEFAULT 0,
      has_audio INTEGER DEFAULT 0,
      context_window INTEGER,
      max_output INTEGER,
      supports_tools INTEGER DEFAULT 0,
      supports_json INTEGER DEFAULT 0,
      or_rank INTEGER,
      or_weekly_volume TEXT,
      or_weekly_change TEXT,
      source_pricing TEXT,
      source_benchmark TEXT,
      is_active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      release_date TEXT,
      notes TEXT,
      verified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_model_type ON model_scores(type)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_model_provider ON model_scores(provider)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_model_active ON model_scores(is_active)`);
}
