import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalTool,
} from "./ir.js";

type OpenAIChatMessage = {
  role?: string;
  content?: string | Array<Record<string, unknown>>;
};

type OpenAIChatRequest = {
  model?: string;
  messages?: OpenAIChatMessage[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  response_format?: unknown;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
};

function normalizeContent(content: OpenAIChatMessage["content"]): CanonicalContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part): CanonicalContentBlock[] => {
    if (part["type"] === "text") {
      return [{ type: "text", text: String(part["text"] ?? "") }];
    }

    if (part["type"] === "image_url") {
      const image = part["image_url"];
      const url =
        typeof image === "object" && image !== null && "url" in image
          ? String((image as { url?: unknown }).url ?? "")
          : undefined;
      return [{ type: "image", url }];
    }

    if (part["type"] === "video_url") {
      const video = part["video_url"];
      const url =
        typeof video === "object" && video !== null && "url" in video
          ? String((video as { url?: unknown }).url ?? "")
          : undefined;
      return [{ type: "video", url }];
    }

    if (part["type"] === "input_audio") {
      return [{ type: "audio" }];
    }

    return [];
  });
}

function normalizeTool(tool: Record<string, unknown>): CanonicalTool {
  const fn = tool["function"];
  const name =
    typeof fn === "object" && fn !== null && "name" in fn
      ? String((fn as { name?: unknown }).name ?? "")
      : undefined;

  return {
    type: String(tool["type"] ?? "function"),
    name,
    raw: tool,
  };
}

export function normalizeOpenAIChatRequest(body: OpenAIChatRequest): CanonicalRequest {
  const messages: CanonicalMessage[] = (body.messages ?? []).map((message) => ({
    role: message.role ?? "user",
    content: normalizeContent(message.content),
  }));

  return {
    protocol: "openai-chat",
    model: body.model ?? "minirouter/auto",
    messages,
    tools: (body.tools ?? []).map(normalizeTool),
    toolChoice: body.tool_choice,
    responseFormat: body.response_format,
    maxOutputTokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
    stream: body.stream === true,
    raw: body,
  };
}

