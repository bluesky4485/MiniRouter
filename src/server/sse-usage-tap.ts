/* eslint-disable @typescript-eslint/no-explicit-any -- upstream SSE JSON has provider-specific schemas. */

/**
 * SSE Usage Tap — 拦截流式响应,从 SSE 事件里抓 usage(token 计数)
 *
 * 用途:流式响应不能像非流式那样 await json() 拿 usage,要在 SSE 流里
 * 解析事件,抓最后的 message_delta(Anthropic)或 data: [DONE] 前的
 * 最终 chunk(OpenAI)里的 usage 字段。
 *
 * 设计:
 *   - 用 TransformStream 包裹 upstream.body
 *   - 解码 chunks → 按 "\n\n" 分割 SSE 事件 → 解析 data: 行
 *   - 抓 usage,output_tokens / completion_tokens 累计
 *   - 原样把 chunks 转发给客户端(不修改流内容)
 *   - 流结束后,通过 promise resolve 返回最终 usage
 *
 * 不修改流内容 = 不影响客户端接收,只是"旁听"。
 */

export interface TapUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

/**
 * 创建一个 SSE 拦截流,返回 { passthrough, finalUsage }。
 * - passthrough: ReadableStream,原样转发给客户端
 * - finalUsage: Promise<TapUsage>,流结束后 resolve,带 usage
 *
 * protocol: "anthropic" 抓 message_delta.usage.output_tokens
 *           "openai" 抓最后一个 chunk 的 usage.completion_tokens
 */
export function createSseUsageTap(
  upstreamBody: ReadableStream<Uint8Array>,
  protocol: "anthropic" | "openai",
): { passthrough: ReadableStream<Uint8Array>; finalUsage: Promise<TapUsage> } {
  const decoder = new TextDecoder();
  let buffer = "";
  const usage: TapUsage = {};
  let resolveUsage: (u: TapUsage) => void;
  const finalUsage = new Promise<TapUsage>((resolve) => {
    resolveUsage = resolve;
  });

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // 原样转发
      controller.enqueue(chunk);
      // 旁听:解码并解析 SSE 事件
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? ""; // 最后一段可能不完整,留着
      for (const evt of events) {
        parseSseEvent(evt, protocol, usage);
      }
    },
    flush() {
      // 处理残留 buffer
      if (buffer.trim()) {
        parseSseEvent(buffer, protocol, usage);
      }
      resolveUsage(usage);
    },
  });

  const passthrough = upstreamBody.pipeThrough(transform);
  // 兜底:若客户端提前断开,flush 仍会被调用(流正常结束),finalUsage 会 resolve。
  // 异常情况(transform 错误)由 pipeThrough 传播,passthrough 读取方会感知,
  // finalUsage 可能不 resolve — 但 logUsage 是 best-effort,不阻塞响应。
  void passthrough;
  return { passthrough, finalUsage };
}

function parseSseEvent(event: string, protocol: "anthropic" | "openai", usage: TapUsage): void {
  // SSE 事件由多行组成,取 data: 行
  const dataLines = event
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) return;

  for (const line of dataLines) {
    if (line === "[DONE]") continue;
    try {
      const json = JSON.parse(line);
      extractUsage(json, protocol, usage);
    } catch {
      // 非 JSON 的 data 行,忽略
    }
  }
}

function extractUsage(json: any, protocol: "anthropic" | "openai", usage: TapUsage): void {
  if (protocol === "anthropic") {
    // Anthropic: message_start 事件有 message.usage.input_tokens
    //            message_delta 事件有 usage.output_tokens(累计)
    if (json?.type === "message_start" && json?.message?.usage) {
      const u = json.message.usage;
      if (u.input_tokens != null) usage.inputTokens = Number(u.input_tokens);
      if (u.cache_read_input_tokens != null) {
        usage.cacheReadTokens = Number(u.cache_read_input_tokens);
      } else if (u.cache_read_tokens != null) {
        usage.cacheReadTokens = Number(u.cache_read_tokens);
      } else if (u.cached_tokens != null) {
        usage.cacheReadTokens = Number(u.cached_tokens);
      } else if (u.prompt_tokens_details?.cached_tokens != null) {
        usage.cacheReadTokens = Number(u.prompt_tokens_details.cached_tokens);
      } else if (u.input_tokens_details?.cached_tokens != null) {
        usage.cacheReadTokens = Number(u.input_tokens_details.cached_tokens);
      }
    }
    if (json?.type === "message_delta" && json?.usage) {
      const u = json.usage;
      if (u.output_tokens != null) usage.outputTokens = Number(u.output_tokens);
    }
  } else {
    // OpenAI: 最后一个 chunk(非 [DONE])有 usage.completion_tokens
    // 也有些 chunk 在 choices[0].delta 里,usage 只在最终 chunk 出现
    if (json?.usage) {
      const u = json.usage;
      if (u.prompt_tokens != null) usage.inputTokens = Number(u.prompt_tokens);
      if (u.completion_tokens != null) usage.outputTokens = Number(u.completion_tokens);
      if (u.cache_read_tokens != null) {
        usage.cacheReadTokens = Number(u.cache_read_tokens);
      } else if (u.cached_tokens != null) {
        usage.cacheReadTokens = Number(u.cached_tokens);
      } else if (u.prompt_tokens_details?.cached_tokens != null) {
        usage.cacheReadTokens = Number(u.prompt_tokens_details.cached_tokens);
      }
      if (u.prompt_tokens_details?.caching?.credits != null) {
        usage.cacheReadTokens = Number(u.prompt_tokens_details.caching.credits);
      }
    }
  }
}
