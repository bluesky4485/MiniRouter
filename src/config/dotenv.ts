import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function parseDotEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) values[key] = value;
  }

  return values;
}

export function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  const parsed = parseDotEnv(readFileSync(path, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

/**
 * Load defaults from the baked-in tuning file (no secrets).
 * Call after `.env` so runtime/config values take precedence.
 */
export function loadDotEnvDefaults(path = resolve(process.cwd(), ".env.tuning")): void {
  if (!existsSync(path)) return;
  const parsed = parseDotEnv(readFileSync(path, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

