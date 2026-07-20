import { createHash } from "node:crypto";
import type { Context } from "hono";
import { extractTextFromContent } from "../routing/features/prompt-digest.js";

/**
 * Extract a stable session identifier for channel pinning.
 *
 * Priority:
 *   1. `x-minirouter-session-id` header
 *   2. `x-session-id` header
 *   3. Derived from `userId:first user message text` (so the same
 *      conversation thread pins to the same provider even without a header)
 *
 * Returns undefined when no session id can be determined (e.g. no user
 * message). In that case channel selection falls back to weight-based
 * primary without session pinning.
 */
export function extractSessionId(
  c: Context,
  messages: { role: string; content: unknown }[],
  userId: string,
): string | undefined {
  const header =
    c.req.header("x-minirouter-session-id") ??
    c.req.header("x-session-id");
  if (header) return header;

  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return undefined;

  const text = extractTextFromContent(firstUser.content);
  if (!text) return undefined;

  return createHash("sha256")
    .update(`${userId}:${text.trim()}`)
    .digest("hex")
    .slice(0, 32);
}
