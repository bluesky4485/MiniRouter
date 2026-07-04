import { describe, expect, it, vi } from "vitest";

import { executeOpenAICompatibleChat } from "./openai-compatible.js";

describe("executeOpenAICompatibleChat", () => {
  it("forwards OpenAI chat requests to the configured base URL and model", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await executeOpenAICompatibleChat(
      {
        model: "minirouter/auto",
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      },
      {
        slot: "fast",
        provider: "auto",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "real-model",
        supportsTools: true,
        supportsVision: true,
      },
      fetchImpl,
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("real-model");
  });

  it("strips tools and tool_choice when the selected slot does not support tools", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "chatcmpl-test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await executeOpenAICompatibleChat(
      {
        model: "minirouter/auto",
        messages: [{ role: "user", content: "describe this image" }],
        tools: [{ type: "function", function: { name: "read_file" } }],
        tool_choice: "auto",
      },
      {
        slot: "vision",
        provider: "auto",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "vision-model",
        supportsTools: false,
        supportsVision: true,
      },
      fetchImpl,
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("vision-model");
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("caps max output tokens to the selected slot context window", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "chatcmpl-test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await executeOpenAICompatibleChat(
      {
        model: "minirouter/auto",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 64000,
        max_completion_tokens: 64000,
      },
      {
        slot: "vision",
        provider: "auto",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "vision-model",
        supportsTools: false,
        supportsVision: true,
        contextWindowTokens: 8192,
      },
      fetchImpl,
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(8192);
    expect(body.max_completion_tokens).toBe(8192);
  });
});
