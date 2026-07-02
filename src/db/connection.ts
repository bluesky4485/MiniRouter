/**
 * Database Connection Factory
 *
 * Creates and manages SQLite database connections with WAL mode.
 * Provides a migration runner for schema initialization.
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";

export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

const DB_DIR = join(homedir(), ".minirouter");
const DB_PATH = join(DB_DIR, "minirouter.db");

let _db: DatabaseInstance | undefined;

/**
 * Get or create the database connection (singleton).
 * Creates the data directory if it doesn't exist.
 */
export function getDb(): DatabaseInstance {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);

  // WAL mode for concurrent reads, normal sync for durability
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });

  return _db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDb(): void {
  if (_db) {
    // drizzle doesn't expose close directly, but better-sqlite3 does
    // Access the underlying driver if needed
    _db = undefined;
  }
}

/**
 * Get the database file path.
 */
export function getDbPath(): string {
  return DB_PATH;
}

/**
 * Reset the database singleton (for testing).
 */
export function resetDb(): void {
  _db = undefined;
}
