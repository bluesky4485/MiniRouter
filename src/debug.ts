/**
 * Debug Logging Utility
 *
 * Togglable request/response body logging for troubleshooting.
 * Enable: MINIROUTER_DEBUG_LOG=true
 *
 * When on, logs full request bodies before upstream forwarding,
 * and full upstream responses after receiving them.
 *
 * Usage in code:
 *   import { debugLog, debugLogResponse } from "../debug.js";
 *   debugLog("inbound", body);
 *   debugLogResponse("upstream", status, bodyText);
 */

function isEnabled(): boolean {
  return process.env["MINIROUTER_DEBUG_LOG"] === "true";
}

function truncate(text: string, maxChars: number = 4000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `... [truncated, ${text.length} total chars]`;
}

/**
 * Log a body, but exclude large messages array to keep output readable.
 */
export function debugLog(label: string, body: unknown): void {
  if (!isEnabled()) return;
  if (typeof body !== "object" || body === null) {
    console.log(`[debug] ${label}: ${truncate(JSON.stringify(body))}`);
    return;
  }
  const record = body as Record<string, unknown>;

  // Log top-level keys and small fields (non-messages), separately from messages size
  const keys = Object.keys(record);
  console.log(`[debug] ${label}: keys=${keys.join(",")}`);
  for (const key of keys) {
    const val = record[key];
    if (key === "messages") {
      console.log(`[debug]     .messages: ${summarizeMessages(val)}`);
    } else if (typeof val === "object" && val !== null) {
      console.log(`[debug]     .${key}: ${truncate(JSON.stringify(val), 1000)}`);
    } else {
      console.log(`[debug]     .${key}: ${JSON.stringify(val)}`);
    }
  }
}

/**
 * Summarize a messages array for debug logging — keeps prompt text observable
 * for after-the-fact "prompt vs routing decision" comparison without dumping
 * full content (which can be huge and contain tool results / images).
 *
 * Format: array[N] roles=user,assistant,user | lastUser="前200字..." | blockTypes=text,image_url
 *
 * blockTypes lists the content block types of the last user message, so we can
 * see whether the client sends Anthropic-native "image" or OpenAI "image_url".
 */
function summarizeMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return `array[?]`;
  const roles = messages
    .map((m) => (typeof m === "object" && m !== null ? (m as Record<string, unknown>).role : "?"))
    .join(",");
  // Find last user message — capture both text and block types
  let lastUserText = "";
  let blockTypes: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (typeof m !== "object" || m === null) continue;
    const rec = m as Record<string, unknown>;
    if (rec.role !== "user") continue;
    const content = rec.content;
    if (typeof content === "string") {
      lastUserText = content;
      blockTypes = ["text(str)"];
      break;
    }
    if (Array.isArray(content)) {
      const texts: string[] = [];
      const types: string[] = [];
      for (const part of content) {
        if (typeof part !== "object" || part === null) continue;
        const pr = part as Record<string, unknown>;
        if (pr.type) types.push(String(pr.type));
        if (pr.type === "text" && typeof pr.text === "string") texts.push(pr.text);
      }
      blockTypes = types;
      if (texts.length > 0) {
        lastUserText = texts.join("\n");
        break;
      }
    }
  }
  const head = lastUserText.slice(0, 200).replace(/\s+/g, " ").trim();
  const typesStr = blockTypes.length ? ` | blockTypes=${blockTypes.join(",")}` : "";
  return `array[${messages.length}] roles=${roles}${typesStr} | lastUser="${head}${lastUserText.length > 200 ? "…" : ""}"`;
}

/**
 * Log a raw text response.
 */
export function debugLogResponse(label: string, status: number, bodyText: string): void {
  if (!isEnabled()) return;
  console.log(`[debug] RESPONSE ${label} → ${status}`);
  console.log(`[debug]     ${truncate(bodyText)}`);
}