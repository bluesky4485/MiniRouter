import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalTool,
} from "./ir.js";

type AnthropicMessage = {
  role?: string;
  content?: string | Array<Record<string, unknown>>;
};

type AnthropicMessagesRequest = {
  model?: string;
  system?: string | Array<Record<string, unknown>>;
  messages?: AnthropicMessage[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  max_tokens?: number;
  stream?: boolean;
};

function normalizeContent(content: AnthropicMessage["content"]): CanonicalContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) return [];

  return content.flatMap((part): CanonicalContentBlock[] => {
    if (part["type"] === "text") {
      return [{ type: "text", text: String(part["text"] ?? "") }];
    }
    if (part["type"] === "image" || part["type"] === "video") {
      const source = part["source"];
      const mediaType =
        typeof source === "object" && source !== null && "media_type" in source
          ? String((source as { media_type?: unknown }).media_type ?? "")
          : undefined;
      return [{ type: part["type"] === "video" ? "video" : "image", mediaType }];
    }
    return [];
  });
}

function normalizeSystem(system: AnthropicMessagesRequest["system"]): CanonicalMessage[] {
  if (!system) return [];
  if (typeof system === "string") {
    return [{ role: "system", content: [{ type: "text", text: system }] }];
  }
  return [{ role: "system", content: normalizeContent(system) }];
}

function normalizeTool(tool: Record<string, unknown>): CanonicalTool {
  return {
    type: "function",
    name: typeof tool["name"] === "string" ? tool["name"] : undefined,
    raw: tool,
  };
}

export function normalizeAnthropicMessagesRequest(body: AnthropicMessagesRequest): CanonicalRequest {
  const messages: CanonicalMessage[] = [
    ...normalizeSystem(body.system),
    ...(body.messages ?? []).map((message) => ({
      role: message.role ?? "user",
      content: normalizeContent(message.content),
    })),
  ];

  return {
    protocol: "anthropic-messages",
    model: body.model ?? "minirouter/auto",
    messages,
    tools: (body.tools ?? []).map(normalizeTool),
    toolChoice: body.tool_choice,
    maxOutputTokens: body.max_tokens ?? 4096,
    stream: body.stream === true,
    raw: body,
  };
}
