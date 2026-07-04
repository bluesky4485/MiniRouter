import { describe, expect, it } from "vitest";

import { compressRequestTail, loadTailCompressionConfig } from "./tail-compression.js";

const longToolOutput = [
  "Started install",
  "status: running",
  ...Array.from({ length: 200 }, (_, i) => `verbose log line ${i}: ${"x".repeat(80)}`),
  "error: package mirror timeout",
  "path: C:\\tmp\\installer.log",
  "status: failed",
].join("\n");

describe("loadTailCompressionConfig", () => {
  it("defaults to disabled", () => {
    expect(loadTailCompressionConfig({}).enabled).toBe(false);
  });
});

describe("compressRequestTail", () => {
  it("compresses OpenAI tool messages without changing static prefix or tool schema", () => {
    const tools = [{ type: "function", function: { name: "shell", parameters: { type: "object" } } }];
    const body = {
      model: "minirouter/auto",
      tools,
      messages: [
        { role: "system", content: "stable system prefix" },
        { role: "user", content: "please install it" },
        { role: "tool", tool_call_id: "call_1", content: longToolOutput },
      ],
    };

    const result = compressRequestTail({
      protocol: "openai-chat",
      body,
      config: { enabled: true, minChars: 1000, maxChars: 800 },
    });

    expect(result.applied).toBe(true);
    expect(result.body.tools).toBe(tools);
    expect(result.body.messages[0]).toEqual(body.messages[0]);
    expect(result.body.messages[1]).toEqual(body.messages[1]);
    expect(result.body.messages[2].content.length).toBeLessThan(longToolOutput.length / 2);
    expect(result.body.messages[2].content).toContain("MiniRouter tail-compressed");
    expect(result.body.messages[2].content).toContain("error: package mirror timeout");
  });

  it("compresses Anthropic tool_result blocks while preserving user text and tool_use blocks", () => {
    const toolUse = { type: "tool_use", id: "toolu_1", name: "shell", input: { command: "install" } };
    const body = {
      model: "minirouter/auto",
      messages: [
        { role: "user", content: [{ type: "text", text: "please install it" }] },
        { role: "assistant", content: [toolUse] },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: longToolOutput },
            { type: "text", text: "continue" },
          ],
        },
      ],
    };

    const result = compressRequestTail({
      protocol: "anthropic-messages",
      body,
      config: { enabled: true, minChars: 1000, maxChars: 800 },
    });

    const compressedBlock = result.body.messages[2].content[0] as { content: string };
    expect(result.applied).toBe(true);
    expect(result.body.messages[0]).toEqual(body.messages[0]);
    expect(result.body.messages[1].content[0]).toEqual(toolUse);
    expect(result.body.messages[2].content[1]).toEqual({ type: "text", text: "continue" });
    expect(compressedBlock.content.length).toBeLessThan(longToolOutput.length / 2);
    expect(compressedBlock.content).toContain("MiniRouter tail-compressed");
    expect(compressedBlock.content).toContain("status: failed");
  });
});
