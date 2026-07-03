/**
 * Prompt Digest — 提取末条 user 消息头部摘要，写入 usage_logs.prompt_digest
 *
 * 用途：事后做"用户问题 vs 路由判定档位"的溯源，检验路由策略是否准确。
 *
 * 设计（原生透传原则下，只读不改）：
 *   - 只取最后一条 user 消息（当前回合的真实意图）
 *   - 截前 200 字，压缩空白，避免长 prompt 撑爆 DB 行
 *   - 只取 text 块，跳过 image / tool_result 等非文本块
 *   - 不存完整内容（隐私 + 体积），够"看出问题类型"即可
 *   - 摘要为空（探测请求 / 纯工具结果）时返回 null
 *
 * 该函数只读 messages，不修改请求体。请求体原样透传给上游。
 */

const MAX_DIGEST_CHARS = 200;

/**
 * 从规范化请求的 messages 中提取末条 user 文本摘要。
 * 兼容 string content 和 array content（多模态消息块）。
 */
export function extractPromptDigest(
  messages: { role: string; content: unknown }[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const text = extractTextFromContent(msg.content);
    if (!text) continue;

    const digest = text.replace(/\s+/g, " ").trim().slice(0, MAX_DIGEST_CHARS);
    return digest.length > 0 ? digest : null;
  }
  return null;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const texts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const pr = part as Record<string, unknown>;
    // Anthropic & OpenAI both use { type: "text", text }
    if (pr.type === "text" && typeof pr.text === "string") {
      texts.push(pr.text);
    }
  }
  return texts.join("\n");
}
