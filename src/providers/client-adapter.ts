/**
 * Client Adapter — client compatibility adapters
 *
 * MiniRouter transparently proxies request bodies (only rewriting the `model`
 * field). However, some clients send bodies that upstream providers reject with
 * 400. This module patches those known gaps.
 *
 * Design:
 * 1. Minimal — only fix reproducible compatibility issues.
 * 2. Observable — every mutation logs the adapter name and change.
 * 3. Idempotent — running the same adapter twice produces the same result.
 *
 * Registry (in execution order):
 *
 * | # | adapter              | client        | problem                          | fix                     |
 * |---|----------------------|---------------|----------------------------------|-------------------------|
 * | 1 | fixEmptyImageDetail  | Claude Code   | image_url.detail="" => 400       | "" => "auto"            |
 *
 * Removed:
 * |   | removeThinkingConfig | Claude Code   | thinking:{type} => 400           | removed thinking field  |
 *   2026-07-03 removed: upstream fixed the bug; removing thinking field prevents
 *   clients from using thinking at all. Now transparently passed through.
 *
 * |   | materializeLocalMediaReferences | local dev | read local file paths from text | removed 2026-07-06 |
 *   Local convenience feature for MVP. Kept in git history for future re-use.
 */

/**
 * [Adapter] fixEmptyImageDetail
 *
 * Trigger: Claude Code sends image_url.detail="" which upstream rejects as 400.
 * Fix: "" -> "auto"
 * Scope: OpenAI-compatible + Anthropic routes
 */
function fixEmptyImageDetail(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;

  let mutated = false;
  const messages = body.messages.map((msg: unknown) => {
    if (typeof msg !== "object" || msg === null) return msg;
    const record = msg as Record<string, unknown>;
    const content = record["content"];
    if (typeof content === "string" || !Array.isArray(content)) return msg;

    return {
      ...record,
      content: content.map((part: unknown) => {
        if (typeof part !== "object" || part === null) return part;
        const pr = part as Record<string, unknown>;
        if (pr["type"] !== "image_url") return part;

        const img = pr["image_url"];
        if (typeof img !== "object" || img === null) return part;
        const imgRec = img as Record<string, unknown>;
        const detail = imgRec["detail"];

        if (detail === "" || detail == null) {
          mutated = true;
          const copy = { ...imgRec };
          copy["detail"] = "auto";
          return { ...pr, image_url: copy };
        }
        return part;
      }),
    };
  });

  if (mutated) {
    console.log("[client-adapter] fixEmptyImageDetail �?detail: '' �?'auto'");
  }

  return { ...body, messages };
}

// ─── Adapter pipeline ──────────────────────────────────────────────────
// Order matters — each adapter sees the output of the previous one.
const adapters = [fixEmptyImageDetail];

/**
 * Run all registered client adapters on a request body.
 * Call this before forwarding to any upstream provider.
 */
export function adaptOpenAICompatibleBody(body: Record<string, unknown>): Record<string, unknown> {
  return adapters.reduce((b, adapter) => adapter(b), body);
}
