import type { Context } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function serveAdminDashboard(c: Context) {
  const html = readFileSync(resolve(process.cwd(), "admin/dashboard.html"), "utf8");
  return c.html(html);
}

