import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  adaptAnthropicMessagesToMiniCpmVisionOpenAI,
  adaptMiniCpmVisionOpenAIResponseToAnthropic,
  materializeLocalMediaReferences,
  materializeLocalMediaReferencesWithDiagnostics,
} from "../../providers/client-adapter.js";

describe("materializeLocalMediaReferences", () => {
  it("keeps native multimodal content unchanged", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Use this uploaded video." },
            { type: "video_url", video_url: { url: "data:video/mp4;base64,abc123" } },
          ],
        },
      ],
    };

    expect(materializeLocalMediaReferences(body)).toBe(body);
  });

  it("turns a local mp4 path in text into an Anthropic video block", () => {
    const dir = join(tmpdir(), `minirouter-media-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const videoPath = join(dir, "sample.mp4");
    writeFileSync(videoPath, Buffer.from([0, 1, 2, 3]));

    try {
      const body = materializeLocalMediaReferences({
        messages: [
          {
            role: "user",
            content: `@"${videoPath}" summarize this video`,
          },
        ],
      });

      expect(body).not.toBeUndefined();
      expect(body.messages).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: `@"${videoPath}" summarize this video` },
            {
              type: "video",
              source: {
                type: "base64",
                media_type: "video/mp4",
                data: "AAECAw==",
              },
            },
          ],
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("turns a local mp4 path in OpenAI chat text into a video_url data URL", () => {
    const dir = join(tmpdir(), `minirouter-media-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const videoPath = join(dir, "sample.mp4");
    writeFileSync(videoPath, Buffer.from([0, 1, 2, 3]));

    try {
      const result = materializeLocalMediaReferencesWithDiagnostics({
        messages: [
          {
            role: "user",
            content: `@"${videoPath}" summarize this video`,
          },
        ],
      }, "openai-chat");

      expect(result.status).toBe("attached");
      expect(result.body.messages).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: `@"${videoPath}" summarize this video` },
            {
              type: "video_url",
              video_url: {
                url: "data:video/mp4;base64,AAECAw==",
              },
            },
          ],
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports too_large when local media exceeds the configured limit", () => {
    const dir = join(tmpdir(), `minirouter-media-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const videoPath = join(dir, "sample.mp4");
    writeFileSync(videoPath, Buffer.from([0, 1, 2, 3]));
    const previous = process.env["MINIROUTER_LOCAL_MEDIA_MAX_BYTES"];
    process.env["MINIROUTER_LOCAL_MEDIA_MAX_BYTES"] = "3";

    try {
      const body = {
        messages: [
          {
            role: "user",
            content: `@"${videoPath}" summarize this video`,
          },
        ],
      };
      const result = materializeLocalMediaReferencesWithDiagnostics(body, "anthropic-messages");

      expect(result.status).toBe("too_large");
      expect(result.body).toBe(body);
      expect(result.filePath).toBe(videoPath);
    } finally {
      if (previous === undefined) {
        delete process.env["MINIROUTER_LOCAL_MEDIA_MAX_BYTES"];
      } else {
        process.env["MINIROUTER_LOCAL_MEDIA_MAX_BYTES"] = previous;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("adaptAnthropicMessagesToMiniCpmVisionOpenAI", () => {
  it("converts Anthropic Messages multimodal requests to OpenAI chat shape", () => {
    const body = adaptAnthropicMessagesToMiniCpmVisionOpenAI({
      model: "minirouter/auto",
      system: "Be concise.",
      max_tokens: 64000,
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "abc123",
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: "save_result",
          description: "Save the result",
          input_schema: { type: "object" },
        },
      ],
      tool_choice: "auto",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });

    expect(body).toEqual({
      model: "minirouter/auto",
      stream: false,
      max_tokens: 2048,
      messages: [
        { role: "system", content: "Be concise." },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,abc123",
              },
            },
            { type: "text", text: "What is in this image?" },
          ],
        },
      ],
    });
  });

  it("instructs the vision model to produce detailed observations as the LLM eyes", () => {
    const body = adaptAnthropicMessagesToMiniCpmVisionOpenAI({
      model: "minirouter/auto",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "video",
              source: {
                type: "base64",
                media_type: "video/mp4",
                data: "abc123",
              },
            },
            { type: "text", text: "总结这个视频" },
          ],
        },
      ],
    });

    const systemPrompt = String((body.messages as Array<Record<string, unknown>>)[0]?.content);
    expect(systemPrompt).toContain("LLM 的眼睛");
    expect(systemPrompt).toContain("尽可能详细");
    expect(systemPrompt).toContain("视频");
    expect(systemPrompt).toContain("OCR");
    expect(systemPrompt).toContain("截图");
    expect(systemPrompt).toContain("用户任务");
  });

  it("drops tool history for OpenAI-compatible vision upstreams", () => {
    const body = adaptAnthropicMessagesToMiniCpmVisionOpenAI({
      model: "minirouter/auto",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will inspect the file." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "read_file",
              input: { path: "D:/MVP/MiniRouter/README.md" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: "README content" }],
            },
            { type: "text", text: "Now look at this screenshot." },
          ],
        },
      ],
    });

    expect(body.messages).toEqual([
      {
        role: "system",
        content: expect.any(String),
      },
      {
        role: "user",
        content: [{ type: "text", text: "Now look at this screenshot." }],
      },
    ]);
  });

  it("keeps only the leading system prompt and the last user prompt", () => {
    const body = adaptAnthropicMessagesToMiniCpmVisionOpenAI({
      model: "minirouter/auto",
      system: "Root instruction.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Before" }] },
        { role: "system", content: [{ type: "text", text: "Late instruction." }] },
        { role: "user", content: [{ type: "text", text: "After" }] },
      ],
    });

    expect(body.messages).toEqual([
      { role: "system", content: "Root instruction." },
      { role: "user", content: [{ type: "text", text: "After" }] },
    ]);
  });

  it("projects long agent history to the latest visual input and user question", () => {
    const body = adaptAnthropicMessagesToMiniCpmVisionOpenAI({
      model: "minirouter/auto",
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "x".repeat(200_000) }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "y".repeat(200_000) }],
        },
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "abc123",
              },
            },
            { type: "text", text: "What is wrong in this screenshot?" },
          ],
        },
      ],
    });

    expect(body.max_tokens).toBe(2048);
    expect(body.messages).toEqual([
      {
        role: "system",
        content: expect.any(String),
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc123" },
          },
          { type: "text", text: "What is wrong in this screenshot?" },
        ],
      },
    ]);
  });

  it("keeps only the latest useful question text for vision prompts", () => {
    const body = adaptAnthropicMessagesToMiniCpmVisionOpenAI({
      model: "minirouter/auto",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "abc123",
              },
            },
            { type: "text", text: "<system-reminder>ignore this</system-reminder>" },
            { type: "text", text: "[Request interrupted by user] 看下数据日志呢" },
            { type: "text", text: "在？在不在？现在好了吗？" },
            { type: "text", text: "总结下这张图" },
          ],
        },
      ],
    });

    expect(body.messages).toEqual([
      {
        role: "system",
        content: expect.any(String),
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc123" },
          },
          { type: "text", text: "总结下这张图" },
        ],
      },
    ]);
  });

  it("converts non-streaming OpenAI chat responses back to Anthropic Messages shape", async () => {
    const response = await adaptMiniCpmVisionOpenAIResponseToAnthropic(
      Response.json({
        id: "chatcmpl_1",
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Looks good." } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
      { model: "minicpm-v-4.6-thinking", stream: false },
    );

    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      id: "chatcmpl_1",
      type: "message",
      role: "assistant",
      model: "minicpm-v-4.6-thinking",
      content: [{ type: "text", text: "Looks good." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 3 },
    });
  });

  it("strips MiniCPM thinking text from non-streaming responses", async () => {
    const response = await adaptMiniCpmVisionOpenAIResponseToAnthropic(
      Response.json({
        id: "chatcmpl_2",
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "首先，用户要求总结这张图。\n</think>\n\n这张图展示了 DeepSeek V4-Pro 与 DSpark 的架构。",
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 20 },
      }),
      { model: "minicpm-v-4.6-thinking", stream: false },
    );

    const json = await response.json();
    expect(json.content).toEqual([
      { type: "text", text: "这张图展示了 DeepSeek V4-Pro 与 DSpark 的架构。" },
    ]);
  });

  it("converts streaming OpenAI chat chunks back to Anthropic SSE events", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const response = await adaptMiniCpmVisionOpenAIResponseToAnthropic(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      { model: "minicpm-v-4.6-thinking", stream: true },
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain('"text":"Hello world"');
    expect(text).toContain("event: message_stop");
  });

  it("strips MiniCPM thinking text from streaming responses", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"首先分析"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"用户问题"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"</think>\\n\\n最终答案"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const response = await adaptMiniCpmVisionOpenAIResponseToAnthropic(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      { model: "minicpm-v-4.6-thinking", stream: true },
    );

    const text = await response.text();
    expect(text).not.toContain("首先分析");
    expect(text).not.toContain("</think>");
    expect(text).toContain('"text":"最终答案"');
  });
});
