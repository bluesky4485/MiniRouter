import type { CanonicalRequest } from "../../protocols/ir.js";

export type RoutingRequirements = {
  toolCalling: boolean;
  structuredOutput: boolean;
  jsonMode: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  longContext: boolean;
  agentic: boolean;
};

export type RoutingFeatures = {
  promptText: string;
  estimatedInputTokens: number;
  estimatedTotalTokens: number;
  requirements: RoutingRequirements;
};

function textFromRequest(request: CanonicalRequest): string {
  return request.messages
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function hasJsonMode(responseFormat: unknown, promptText: string): boolean {
  if (typeof responseFormat === "object" && responseFormat !== null) {
    const type = "type" in responseFormat ? String((responseFormat as { type?: unknown }).type) : "";
    if (type.includes("json")) return true;
  }
  return /\bjson\b|schema|structured/i.test(promptText);
}

export function extractRoutingFeatures(request: CanonicalRequest): RoutingFeatures {
  const promptText = textFromRequest(request);
  const estimatedInputTokens = Math.ceil(promptText.length / 4);
  // Check both Anthropic-native "image" and OpenAI-style "image_url" (Claude Code sends both).
  const hasVision = request.messages.some((message) =>
    message.content.some((block) => (block as { type: string }).type === "image" || (block as { type: string }).type === "image_url"),
  );
  const hasAudio = request.messages.some((message) =>
    message.content.some((block) => block.type === "audio"),
  );
  const hasVideo = request.messages.some((message) =>
    message.content.some((block) => block.type === "video"),
  );
  const toolCalling = request.tools.length > 0;
  const jsonMode = hasJsonMode(request.responseFormat, promptText);
  const longContext = estimatedInputTokens + request.maxOutputTokens > 100_000;
  const agentic =
    toolCalling ||
    /\b(edit|modify|debug|fix|run|execute|deploy|install|search|open file|read file)\b/i.test(
      promptText,
    );

  return {
    promptText,
    estimatedInputTokens,
    estimatedTotalTokens: estimatedInputTokens + request.maxOutputTokens,
    requirements: {
      toolCalling,
      structuredOutput: jsonMode,
      jsonMode,
      // Treat video/audio as vision — multimodal requests need the vision slot
      vision: hasVision || hasVideo || hasAudio,
      audio: hasAudio,
      video: hasVideo,
      longContext,
      agentic,
    },
  };
}

