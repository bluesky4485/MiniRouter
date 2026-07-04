import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

/**
 * Client Adapter — 客户端兼容性适配层
 *
 * 定位：MiniRouter 网关原则上原样透传请求体（只替换 model 字段）。
 * 但部分客户端发出的请求体，在某些上游供应商的严格 schema 校验下会
 * 被 400 拒绝。本模块就是为了解决这些"客户端 vs 上游"的兼容性 gap。
 *
 * 设计原则：
 * 1. 最小改动 — 只修复已知的、可复现的兼容问题，不"帮用户改格式"
 * 2. 可观测 — 每次修改 body 必须打印日志，标注 adapter 名称和改动内容
 * 3. 幂等 — 同一个 adapter 运行多次结果相同
 * 4. 不破坏原生性 — 不做格式转换（如 Anthropic → OpenAI），只做补丁
 * 5. 新增 adapter 必须附带注释说明：触发客户端、报错场景、改动内容
 *
 * 适配器注册表（按执行顺序）：
 *
 * | # | adapter              | 触发客户端   | 问题                                         | 改动                    |
 * |---|----------------------|-------------|----------------------------------------------|------------------------|
 * | 1 | fixEmptyImageDetail  | Claude Code | image_url.detail="" 被上游 400                | "" → "auto"            |
 *
 * 已移除：
 * |   | removeThinkingConfig | Claude Code | thinking: {type} 被转为 thinking_budget=0 400 | 直接移除 thinking 字段  |
 *   2026-07-03 移除：胜算云已修复该 bug（probe 验证 thinking:{type:"adaptive"} 返回 200，
 *   thinking:{type:"enabled",budget_tokens} 能真正开启思考）。原 adapter 删字段反而
 *   害客户端开不了思考。按"原生透传"原则，thinking 字段原样发给上游。
 *
 * 如何添加新 adapter：
 * 1. 在下方定义函数：(body) => Record<string, unknown>
 * 2. 函数签名：接收 body，返回 body（可以是原对象或浅拷贝）
 * 3. 只有 body 被修改时才 console.log，格式：
 *    [client-adapter] <adapter-id> → <brief description>
 * 4. 将函数 push 到 adapters 数组
 */

/**
 * [Adapter] fixEmptyImageDetail
 *
 * 触发客户端：Claude Code（发 vision 请求时 image_url.detail 为空字符串）
 * 报错场景：Claude Code 发 image_url.detail="" 或 undefined，上游严格校验后 400。
 *           "detail: invalid value: ``, supported values: low/high/xhigh/auto"
 * 改动内容：将 detail: "" 或 detail: undefined 改为 detail: "auto"
 * 影响范围：OpenAI 兼容路由 + Anthropic 路由
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
    console.log("[client-adapter] fixEmptyImageDetail → detail: '' → 'auto'");
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

const LOCAL_MEDIA_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

type LocalMediaProtocol = "anthropic-messages" | "openai-chat";
type LocalMediaStatus =
  | "attached"
  | "already_has_media"
  | "no_messages"
  | "no_text"
  | "no_path"
  | "path_not_found"
  | "unsupported_type"
  | "not_file"
  | "too_large"
  | "read_failed";

export type LocalMediaMaterializationResult = {
  body: Record<string, unknown>;
  status: LocalMediaStatus;
  filePath?: string;
  bytes?: number;
  error?: string;
};

function localMediaMaxBytes(): number {
  const raw = Number(process.env["MINIROUTER_LOCAL_MEDIA_MAX_BYTES"]);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 256 * 1024 * 1024;
}

function hasClientVisionContent(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    if (typeof message !== "object" || message === null) return false;
    const content = (message as Record<string, unknown>)["content"];
    return Array.isArray(content) && content.some(isVisionPart);
  });
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const record = part as Record<string, unknown>;
      return record["type"] === "text" && typeof record["text"] === "string" ? record["text"] : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractLocalMediaPath(text: string): { filePath?: string; status: LocalMediaStatus } {
  const pattern =
    /@?"([^"]+\.(?:png|jpe?g|webp|gif|mp4|mov|m4v|webm|mkv))"|([A-Za-z]:\\[^\r\n"'<>]+\.(?:png|jpe?g|webp|gif|mp4|mov|m4v|webm|mkv))|((?:\/[^\s"'<>]+)+\.(?:png|jpe?g|webp|gif|mp4|mov|m4v|webm|mkv))/gi;

  let sawCandidate = false;
  for (const match of text.matchAll(pattern)) {
    const candidate = match[1] ?? match[2] ?? match[3];
    if (!candidate) continue;
    sawCandidate = true;
    if (!LOCAL_MEDIA_MIME[extname(candidate).toLowerCase()]) {
      return { filePath: candidate, status: "unsupported_type" };
    }
    if (!existsSync(candidate)) {
      return { filePath: candidate, status: "path_not_found" };
    }
    return { filePath: candidate, status: "attached" };
  }

  return { status: sawCandidate ? "unsupported_type" : "no_path" };
}

function localMediaBlock(
  filePath: string,
  protocol: LocalMediaProtocol,
): { block?: Record<string, unknown>; status: LocalMediaStatus; bytes?: number; error?: string } {
  const mediaType = LOCAL_MEDIA_MIME[extname(filePath).toLowerCase()];
  if (!mediaType) return { status: "unsupported_type" };

  const stat = statSync(filePath);
  if (!stat.isFile()) return { status: "not_file" };
  if (stat.size > localMediaMaxBytes()) {
    return { status: "too_large", bytes: stat.size };
  }

  try {
    const data = readFileSync(filePath).toString("base64");
    const isVideo = mediaType.startsWith("video/");
    if (protocol === "openai-chat") {
      const type = isVideo ? "video_url" : "image_url";
      return {
        status: "attached",
        bytes: stat.size,
        block: {
          type,
          [type]: { url: `data:${mediaType};base64,${data}` },
        },
      };
    }

    return {
      status: "attached",
      bytes: stat.size,
      block: {
        type: isVideo ? "video" : "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data,
        },
      },
    };
  } catch (error) {
    return { status: "read_failed", bytes: stat.size, error: (error as Error).message };
  }
}

/**
 * [Adapter] materializeLocalMediaReferences
 *
 * Scope: local MVP convenience only. If the client already sends native
 * image/video blocks, this adapter returns the original body unchanged. If a
 * local file path is present only as text, it appends an Anthropic-native media
 * block so the normal vision preprocessing path can run.
 */
export function materializeLocalMediaReferencesWithDiagnostics(
  body: Record<string, unknown>,
  protocol: LocalMediaProtocol = "anthropic-messages",
): LocalMediaMaterializationResult {
  if (hasClientVisionContent(body["messages"])) return { body, status: "already_has_media" };
  const messages = body["messages"];
  if (!Array.isArray(messages)) return { body, status: "no_messages" };

  let sawText = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;
    const text = extractTextFromContent(record["content"]);
    if (!text) continue;
    sawText = true;

    const pathResult = extractLocalMediaPath(text);
    if (!pathResult.filePath) continue;
    if (pathResult.status !== "attached") {
      console.error(`[client-adapter] localMediaReference skipped status=${pathResult.status} path=${pathResult.filePath}`);
      return { body, status: pathResult.status, filePath: pathResult.filePath };
    }

    try {
      const media = localMediaBlock(pathResult.filePath, protocol);
      if (!media.block) {
        console.error(
          `[client-adapter] localMediaReference skipped status=${media.status} path=${pathResult.filePath} bytes=${media.bytes ?? "unknown"}`,
        );
        return {
          body,
          status: media.status,
          filePath: pathResult.filePath,
          bytes: media.bytes,
          error: media.error,
        };
      }
      const nextContent = Array.isArray(record["content"])
        ? [...record["content"], media.block]
        : [{ type: "text", text }, media.block];
      const nextMessages = [...messages];
      nextMessages[i] = { ...record, content: nextContent };
      console.error(
        `[client-adapter] localMediaReference -> ${protocol} media block path=${pathResult.filePath} bytes=${media.bytes ?? "unknown"}`,
      );
      return {
        body: { ...body, messages: nextMessages },
        status: "attached",
        filePath: pathResult.filePath,
        bytes: media.bytes,
      };
    } catch (error) {
      console.error(`[client-adapter] localMediaReference failed: ${(error as Error).message}`);
      return { body, status: "read_failed", filePath: pathResult.filePath, error: (error as Error).message };
    }
  }

  return { body, status: sawText ? "no_path" : "no_text" };
}

export function materializeLocalMediaReferences(
  body: Record<string, unknown>,
  protocol: LocalMediaProtocol = "anthropic-messages",
): Record<string, unknown> {
  return materializeLocalMediaReferencesWithDiagnostics(body, protocol).body;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated for vision model]`;
}

function isVisionPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false;
  const type = (part as Record<string, unknown>)["type"];
  return type === "image" || type === "video" || type === "image_url" || type === "video_url" || type === "input_image";
}

function isUsefulVisionQuestionText(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false;
  const record = part as Record<string, unknown>;
  if (record["type"] !== "text" || typeof record["text"] !== "string") return false;
  const text = record["text"].trim();
  if (!text) return false;
  if (text.startsWith("<system-reminder>")) return false;
  if (text.includes("[Request interrupted by user]")) return false;
  if (/^(在[？?]?|在不在[？?]?|现在好了吗[？?]?)+$/.test(text.replace(/\s+/g, ""))) return false;
  return true;
}

function selectVisionQuestionTextParts(content: unknown[]): unknown[] {
  const usefulTextParts = content.filter(isUsefulVisionQuestionText);
  const lastText = usefulTextParts.at(-1);
  if (!lastText) return [{ type: "text", text: "请用中文简要总结这张图，按核心主题、主要模块、业务流程三点回答。" }];
  const record = lastText as Record<string, unknown>;
  return [{
    ...record,
    text: truncateText(String(record["text"]), 500),
  }];
}

function anthropicContentToMiniCpmOpenAI(content: unknown, mode: "vision-prompt" | "history" = "history"): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;

  const converted = content.flatMap((part): unknown[] => {
    if (typeof part !== "object" || part === null) return [part];
    const record = part as Record<string, unknown>;
    const type = record["type"];

    if (type === "text") {
      const text = typeof record["text"] === "string" ? truncateText(record["text"], 4000) : record["text"];
      return [{ ...record, text }];
    }

    if (type === "thinking") return mode === "vision-prompt" ? [] : [part];

    if (type === "image_url" || type === "video_url" || type === "input_image") return [part];

    if (type === "tool_use") {
      if (mode === "vision-prompt") return [];
      const name = typeof record["name"] === "string" ? record["name"] : "unknown";
      const input = record["input"] === undefined ? "" : ` ${JSON.stringify(record["input"])}`;
      return [{ type: "text", text: `[tool_use:${name}]${input}` }];
    }

    if (type === "tool_result") {
      if (mode === "vision-prompt") return [];
      const toolUseId = typeof record["tool_use_id"] === "string" ? record["tool_use_id"] : "unknown";
      const toolContent = record["content"];
      if (typeof toolContent === "string") {
        return [{ type: "text", text: `[tool_result:${toolUseId}] ${toolContent}` }];
      }
      if (Array.isArray(toolContent)) {
        const text = toolContent
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .filter((item) => item["type"] === "text" && typeof item["text"] === "string")
          .map((item) => item["text"])
          .join("\n");
        return text ? [{ type: "text", text: `[tool_result:${toolUseId}] ${text}` }] : [];
      }
      return [];
    }

    if (type !== "image" && type !== "video") return [];

    const source = record["source"];
    if (typeof source !== "object" || source === null) return [];
    const sourceRecord = source as Record<string, unknown>;
    const mediaType = String(sourceRecord["media_type"] ?? (type === "video" ? "video/mp4" : "image/png"));
    const data = sourceRecord["data"];
    const url =
      sourceRecord["type"] === "base64" && typeof data === "string"
        ? `data:${mediaType};base64,${data}`
        : sourceRecord["url"];

    return [{
      type: type === "video" ? "video_url" : "image_url",
      [type === "video" ? "video_url" : "image_url"]: { url },
    }];
  });

  if (converted.length === 0) return "";
  return converted;
}

function systemContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part !== "object" || part === null) return "";
      const record = part as Record<string, unknown>;
      return typeof record["text"] === "string" ? record["text"] : "";
    })
    .filter(Boolean)
    .join("\n");
}

function selectMiniCpmVisionPrompt(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) return [];

  let lastVisionUser: Record<string, unknown> | undefined;
  let lastUser: Record<string, unknown> | undefined;
  let lastVisionContent: unknown[] = [];

  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;
    const content = Array.isArray(record["content"]) ? record["content"] : [];
    const visionParts = content.filter(isVisionPart);
    if (visionParts.length > 0) {
      lastVisionContent = visionParts;
      if (record["role"] === "user") lastVisionUser = record;
    }
    if (record["role"] === "user") lastUser = record;
  }

  const selected = lastVisionUser ?? lastUser;
  if (!selected) return [];

  const selectedContent = Array.isArray(selected["content"]) ? selected["content"] : selected["content"];
  if (Array.isArray(selectedContent) && selectedContent.some(isVisionPart)) {
    const visionParts = selectedContent.filter(isVisionPart);
    return [{
      role: "user",
      content: anthropicContentToMiniCpmOpenAI([
        ...visionParts,
        ...selectVisionQuestionTextParts(selectedContent),
      ], "vision-prompt"),
    }];
  }

  const textParts = Array.isArray(selectedContent)
    ? selectedContent.filter((part) => {
      if (typeof part !== "object" || part === null) return false;
      const record = part as Record<string, unknown>;
      return record["type"] === "text" && typeof record["text"] === "string";
    })
    : typeof selectedContent === "string"
      ? [{ type: "text", text: selectedContent }]
      : [];

  return [{
    role: "user",
    content: anthropicContentToMiniCpmOpenAI([...lastVisionContent, ...textParts], "vision-prompt"),
  }];
}

/**
 * MiniCPM-V visual slot adapter.
 *
 * Scope: only Anthropic Messages ingress routed to an OpenAI-compatible
 * MiniCPM-V vision slot. This is intentionally not part of the generic OpenAI
 * adapter pipeline because it translates Anthropic content blocks into the
 * specific content part set accepted by the MiniCPM-V serving stack.
 */
const DEFAULT_VISION_OBSERVER_PROMPT =
  "你是 LLM 的眼睛，是中文多模态内容观察员。请只基于用户提供的图片或视频内容输出高密度观察记录，不要输出思考过程，不要代替最终 LLM 做泛化结论。你的目标是按用户任务补足视觉证据：如果用户要总结，请提供主题、事件、阶段和关键信息；如果用户要 OCR/提取文字，请尽量逐字记录所有可见文字、数字、表格和标签；如果用户给的是截图，请描述界面状态、按钮、菜单、报错、选中项和操作线索；如果用户给的是图表/流程图/架构图，请描述标题、节点、连线、层级、数据、方向和模块关系；如果用户要对比/找问题，请列出差异、异常点、风险点和不确定处；如果用户给的是视频，请按可见阶段或时间顺序展开人物/物体、动作、镜头变化、场景变化、字幕/画面文字和关键事件。对图片和视频都要尽可能详细，描述主体、场景、空间关系、颜色、布局和细节。若内容看不清，请说明哪些信息不可见或不确定。用清晰中文分点输出，保留必要英文术语并保持空格。";

export function adaptAnthropicMessagesToMiniCpmVisionOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const messages = selectMiniCpmVisionPrompt(body["messages"]);
  const system = systemContentToText(body["system"]);
  messages.unshift({
    role: "system",
    content: system ? truncateText(system, 1000) : DEFAULT_VISION_OBSERVER_PROMPT,
  });

  const result: Record<string, unknown> = {
    model: body["model"],
    messages,
    stream: false,
    max_tokens: Math.min(typeof body["max_tokens"] === "number" ? body["max_tokens"] : 2048, 2048),
  };
  return result;
}

function openAIContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part !== "object" || part === null) return "";
      const record = part as Record<string, unknown>;
      return typeof record["text"] === "string" ? record["text"] : "";
    })
    .filter(Boolean)
    .join("\n");
}

function stripMiniCpmThinkingText(text: string): string {
  let rest = text;
  while (true) {
    const open = rest.indexOf("<think>");
    const close = rest.indexOf("</think>");
    if (open >= 0 && close > open) {
      rest = `${rest.slice(0, open)}${rest.slice(close + "</think>".length)}`;
      continue;
    }
    if (close >= 0 && (open < 0 || close < open)) {
      rest = rest.slice(close + "</think>".length);
      continue;
    }
    if (open >= 0) {
      rest = rest.slice(0, open);
      continue;
    }
    return rest.trimStart();
  }
}

function createMiniCpmThinkingStreamFilter(): { push: (text: string) => string; flush: () => string } {
  let buffering = true;
  let buffer = "";

  return {
    push(text: string): string {
      if (!text) return "";
      if (!buffering) return stripMiniCpmThinkingText(text);

      buffer += text;
      const close = buffer.indexOf("</think>");
      if (close >= 0) {
        buffering = false;
        const afterThinking = buffer.slice(close + "</think>".length);
        buffer = "";
        return stripMiniCpmThinkingText(afterThinking);
      }

      const open = buffer.indexOf("<think>");
      if (open >= 0) return "";

      return "";
    },
    flush(): string {
      if (!buffering) return "";
      buffering = false;
      const text = stripMiniCpmThinkingText(buffer);
      buffer = "";
      return text;
    },
  };
}

function anthropicMessageFromOpenAI(json: any, model: string): Record<string, unknown> {
  const choice = json?.choices?.[0] ?? {};
  const usage = json?.usage ?? {};
  return {
    id: typeof json?.id === "string" ? json.id : `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: stripMiniCpmThinkingText(openAIContentToText(choice?.message?.content)) }],
    stop_reason: choice?.finish_reason === "length" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? 0),
    },
  };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function openAIStreamDeltaToText(json: any): string {
  const content = json?.choices?.[0]?.delta?.content;
  if (typeof content === "string") return content;
  return openAIContentToText(content);
}

function adaptOpenAIStreamToAnthropic(upstream: Response, model: string): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const messageId = `msg_${Date.now()}`;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (text: string) => controller.enqueue(encoder.encode(text));
      enqueue(sse("message_start", {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
      enqueue(sse("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }));

      const reader = upstream.body?.getReader();
      if (!reader) {
        enqueue(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
        enqueue(sse("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 0 },
        }));
        enqueue(sse("message_stop", { type: "message_stop" }));
        controller.close();
        return;
      }

      let buffer = "";
      let outputChars = 0;
      const thinkingFilter = createMiniCpmThinkingStreamFilter();
      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          const text = thinkingFilter.push(openAIStreamDeltaToText(json));
          if (text) {
            outputChars += text.length;
            enqueue(sse("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text },
            }));
          }
        } catch {
          // Ignore malformed provider chunks; the final Anthropic stream will still close cleanly.
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }
      if (buffer) processLine(buffer);
      const flushed = thinkingFilter.flush();
      if (flushed) {
        outputChars += flushed.length;
        enqueue(sse("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: flushed },
        }));
      }

      enqueue(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
      enqueue(sse("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: Math.ceil(outputChars / 4) },
      }));
      enqueue(sse("message_stop", { type: "message_stop" }));
      controller.close();
    },
  });

  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

export async function adaptMiniCpmVisionOpenAIResponseToAnthropic(
  upstream: Response,
  input: { model: string; stream: boolean },
): Promise<Response> {
  if (!upstream.ok) return upstream;
  if (input.stream) return adaptOpenAIStreamToAnthropic(upstream, input.model);

  try {
    const json = await upstream.json();
    return Response.json(anthropicMessageFromOpenAI(json, input.model), { status: upstream.status });
  } catch {
    return upstream;
  }
}
