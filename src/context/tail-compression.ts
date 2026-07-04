export type TailCompressionProtocol = "openai-chat" | "anthropic-messages";

export type TailCompressionConfig = {
  enabled: boolean;
  minChars: number;
  maxChars: number;
};

export type TailCompressionResult<TBody> = {
  body: TBody;
  applied: boolean;
  originalChars: number;
  compressedChars: number;
  compressedBlocks: number;
};

type EnvLike = Record<string, string | undefined>;

function readBool(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadTailCompressionConfig(env: EnvLike = process.env): TailCompressionConfig {
  return {
    enabled: readBool(env["MINIROUTER_TAIL_COMPRESSION_ENABLED"]),
    minChars: readNumber(env["MINIROUTER_TAIL_COMPRESSION_MIN_CHARS"], 12_000),
    maxChars: readNumber(env["MINIROUTER_TAIL_COMPRESSION_MAX_CHARS"], 2_000),
  };
}

function messageChars(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  return JSON.stringify(value).length;
}

function compactLines(lines: string[], pattern: RegExp, limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 280 || !pattern.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

function compressLongText(content: string, config: TailCompressionConfig): string {
  if (content.length < config.minChars) return content;

  const lines = content.split(/\r?\n/);
  const important = compactLines(
    lines,
    /error|exception|failed|denied|refused|timeout|invalid|warning|success|complete|created|updated|found|result|status|total|count|path|file/i,
    16,
  );

  const header = `[MiniRouter tail-compressed tool output: original ${content.length} chars]`;
  const importantText = important.length > 0 ? `\n\n[important]\n${important.join("\n")}` : "";
  const budget = Math.max(config.maxChars - header.length - importantText.length - 40, 200);
  const headBudget = Math.floor(budget * 0.55);
  const tailBudget = budget - headBudget;
  const head = content.slice(0, headBudget).trimEnd();
  const tail = content.slice(Math.max(0, content.length - tailBudget)).trimStart();

  return `${header}\n\n[head]\n${head}${importantText}\n\n[tail]\n${tail}`;
}

function cloneWithMessages<TBody extends Record<string, unknown>>(body: TBody, messages: unknown[]): TBody {
  return { ...body, messages } as TBody;
}

function compressOpenAITail<TBody extends Record<string, unknown>>(
  body: TBody,
  config: TailCompressionConfig,
): TailCompressionResult<TBody> {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return { body, applied: false, originalChars: 0, compressedChars: 0, compressedBlocks: 0 };
  }

  let applied = false;
  let compressedBlocks = 0;
  let originalChars = 0;
  let compressedChars = 0;
  const compressedMessages = messages.map((message) => {
    if (typeof message !== "object" || message === null) return message;
    const record = message as Record<string, unknown>;
    if (record.role !== "tool" || typeof record.content !== "string") return message;

    const original = record.content;
    const compressed = compressLongText(original, config);
    if (compressed === original) return message;

    applied = true;
    compressedBlocks += 1;
    originalChars += original.length;
    compressedChars += compressed.length;
    return { ...record, content: compressed };
  });

  return {
    body: applied ? cloneWithMessages(body, compressedMessages) : body,
    applied,
    originalChars,
    compressedChars,
    compressedBlocks,
  };
}

function compressAnthropicToolResultContent(content: unknown, config: TailCompressionConfig): {
  content: unknown;
  applied: boolean;
  originalChars: number;
  compressedChars: number;
} {
  if (typeof content === "string") {
    const compressed = compressLongText(content, config);
    return {
      content: compressed,
      applied: compressed !== content,
      originalChars: content.length,
      compressedChars: compressed.length,
    };
  }

  if (!Array.isArray(content)) {
    return { content, applied: false, originalChars: 0, compressedChars: 0 };
  }

  let applied = false;
  let originalChars = 0;
  let compressedChars = 0;
  const parts = content.map((part) => {
    if (typeof part !== "object" || part === null) return part;
    const record = part as Record<string, unknown>;
    if (record.type !== "text" || typeof record.text !== "string") return part;
    const compressed = compressLongText(record.text, config);
    if (compressed === record.text) return part;
    applied = true;
    originalChars += record.text.length;
    compressedChars += compressed.length;
    return { ...record, text: compressed };
  });

  return { content: applied ? parts : content, applied, originalChars, compressedChars };
}

function compressAnthropicTail<TBody extends Record<string, unknown>>(
  body: TBody,
  config: TailCompressionConfig,
): TailCompressionResult<TBody> {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return { body, applied: false, originalChars: 0, compressedChars: 0, compressedBlocks: 0 };
  }

  let applied = false;
  let compressedBlocks = 0;
  let originalChars = 0;
  let compressedChars = 0;
  const compressedMessages = messages.map((message) => {
    if (typeof message !== "object" || message === null) return message;
    const record = message as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) return message;

    let messageChanged = false;
    const compressedContent = content.map((part) => {
      if (typeof part !== "object" || part === null) return part;
      const block = part as Record<string, unknown>;
      if (block.type !== "tool_result") return part;

      const result = compressAnthropicToolResultContent(block.content, config);
      if (!result.applied) return part;

      applied = true;
      messageChanged = true;
      compressedBlocks += 1;
      originalChars += result.originalChars;
      compressedChars += result.compressedChars;
      return { ...block, content: result.content };
    });

    return messageChanged ? { ...record, content: compressedContent } : message;
  });

  return {
    body: applied ? cloneWithMessages(body, compressedMessages) : body,
    applied,
    originalChars,
    compressedChars,
    compressedBlocks,
  };
}

export function compressRequestTail<TBody extends Record<string, unknown>>(input: {
  protocol: TailCompressionProtocol;
  body: TBody;
  config?: TailCompressionConfig;
}): TailCompressionResult<TBody> {
  const config = input.config ?? loadTailCompressionConfig();
  if (!config.enabled) {
    return { body: input.body, applied: false, originalChars: 0, compressedChars: 0, compressedBlocks: 0 };
  }

  if (input.protocol === "openai-chat") {
    return compressOpenAITail(input.body, config);
  }

  return compressAnthropicTail(input.body, config);
}
