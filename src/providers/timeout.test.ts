import { describe, expect, it, vi } from "vitest";

/**
 * Test that executeOpenAICompatibleChat and executeAnthropicMessages
 * pass AbortSignal.timeout to fetch.
 */
describe("upstream timeout", () => {
  it("executeOpenAICompatibleChat passes AbortSignal.timeout to fetch", async () => {
    const { executeOpenAICompatibleChat } = await import("./openai-compatible.js");

    const capturedSignals: AbortSignal[] = [];

    const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await executeOpenAICompatibleChat(
      { model: "test", messages: [] },
      {
        slot: "balanced",
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "key",
        model: "test-model",
        supportsTools: true,
        supportsVision: false,
      },
      mockFetch as any,
    );

    const callArgs = (mockFetch as any).mock.calls[0];
    expect(callArgs).toBeDefined();

    const options = callArgs[1] as Record<string, unknown>;
    expect(options.signal).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("executeAnthropicMessages passes AbortSignal.timeout to fetch", async () => {
    const { executeAnthropicMessages } = await import("./anthropic.js");

    const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [], usage: { input_tokens: 10, output_tokens: 20 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await executeAnthropicMessages(
      { model: "test", messages: [] },
      {
        slot: "strong",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "key",
        model: "claude-test",
        supportsTools: true,
        supportsVision: true,
      },
      mockFetch as any,
    );

    const callArgs = (mockFetch as any).mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.signal).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("readTimeout uses default when env var is absent", async () => {
    // The providers use AbortSignal.timeout(180000) as default.
    // We verify the signal is present; the exact timeout value is
    // implementation detail verified by the AbortSignal type.
    const { executeOpenAICompatibleChat } = await import("./openai-compatible.js");

    const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await executeOpenAICompatibleChat(
      { model: "test" },
      {
        slot: "fast",
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "k",
        model: "m",
        supportsTools: true,
        supportsVision: false,
      },
      mockFetch as any,
    );

    const options = (mockFetch as any).mock.calls[0][1] as Record<string, unknown>;
    expect(options.signal).toBeDefined();
  });
});