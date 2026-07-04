import { describe, expect, it } from "vitest";

import { parseAnthropicUsage, parseOpenAIUsage } from "./routes/chat.js";
import { createSseUsageTap } from "./sse-usage-tap.js";

describe("usage parsing", () => {
  it("parses OpenAI-compatible cached_tokens from non-streaming usage", async () => {
    const response = Response.json({
      usage: {
        prompt_tokens: 5210,
        completion_tokens: 14,
        prompt_tokens_details: {
          cached_tokens: 5120,
        },
      },
    });

    await expect(parseOpenAIUsage(response)).resolves.toEqual({
      promptTokens: 5210,
      completionTokens: 14,
      cacheReadTokens: 5120,
    });
  });

  it("parses OpenAI-compatible cached_tokens from streaming usage chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"usage":{"prompt_tokens":5210,"completion_tokens":14,"prompt_tokens_details":{"cached_tokens":5120}}}\n\n',
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const { passthrough, finalUsage } = createSseUsageTap(body, "openai");
    await new Response(passthrough).text();

    await expect(finalUsage).resolves.toEqual({
      inputTokens: 5210,
      outputTokens: 14,
      cacheReadTokens: 5120,
    });
  });

  it("parses cached_tokens from non-streaming Anthropic-compatible usage", async () => {
    const response = Response.json({
      usage: {
        input_tokens: 5093,
        output_tokens: 23,
        prompt_tokens_details: {
          cached_tokens: 4992,
        },
      },
    });

    await expect(parseAnthropicUsage(response)).resolves.toEqual({
      promptTokens: 5093,
      completionTokens: 23,
      cacheReadTokens: 4992,
    });
  });

  it("parses cached_tokens from streaming Anthropic-compatible usage chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"message_start","message":{"usage":{"input_tokens":5093,"prompt_tokens_details":{"cached_tokens":4992}}}}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"type":"message_delta","usage":{"output_tokens":23}}\n\n',
        ));
        controller.close();
      },
    });

    const { passthrough, finalUsage } = createSseUsageTap(body, "anthropic");
    await new Response(passthrough).text();

    await expect(finalUsage).resolves.toEqual({
      inputTokens: 5093,
      outputTokens: 23,
      cacheReadTokens: 4992,
    });
  });
});
