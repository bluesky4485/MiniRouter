import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { extractSessionId } from "./session-id.js";

function makeContext(headers: Record<string, string>): Context {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
  } as unknown as Context;
}

describe("extractSessionId", () => {
  it("uses x-minirouter-session-id header when present", () => {
    const c = makeContext({ "x-minirouter-session-id": "my-session" });
    const id = extractSessionId(c, [{ role: "user", content: "hello" }], "user-1");
    expect(id).toBe("my-session");
  });

  it("falls back to x-session-id header", () => {
    const c = makeContext({ "x-session-id": "fallback-session" });
    const id = extractSessionId(c, [{ role: "user", content: "hello" }], "user-1");
    expect(id).toBe("fallback-session");
  });

  it("derives a stable id from the first user message when no header", () => {
    const c = makeContext({});
    const messages = [
      { role: "system", content: "you are a helper" },
      { role: "user", content: "hello world" },
    ];
    const id1 = extractSessionId(c, messages, "user-1");
    const id2 = extractSessionId(c, messages, "user-1");
    expect(id1).toBeDefined();
    expect(id1).toBe(id2);
    expect(id1).not.toBe(extractSessionId(c, messages, "user-2"));
  });

  it("returns undefined when there is no user message", () => {
    const c = makeContext({});
    const id = extractSessionId(c, [{ role: "system", content: "hello" }], "user-1");
    expect(id).toBeUndefined();
  });
});
