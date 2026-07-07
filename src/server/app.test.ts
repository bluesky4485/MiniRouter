import { describe, expect, it, vi } from "vitest";

vi.mock("./routes/chat.js", () => ({
  chatCompletions: (c: { json: (body: unknown) => Response }) => c.json({ ok: true }),
}));

vi.mock("./routes/models.js", () => ({
  listModels: (c: { json: (body: unknown) => Response }) => c.json({ object: "list", data: [] }),
}));

vi.mock("./routes/models-api.js", () => ({
  listModelScores: (c: { json: (body: unknown) => Response }) =>
    c.json({ data: [{ id: "zhipu/glm-4.5" }], count: 1 }),
  getModelScore: (c: { json: (body: unknown) => Response }) => c.json({ id: "zhipu/glm-4.5" }),
  updateModelScore: (c: { json: (body: unknown) => Response }) => c.json({ status: "updated" }),
}));

describe("createApp", () => {
  it("serves database-backed model score data at /api/models without API key auth", async () => {
    const { createApp } = await import("./app.js");
    const app = createApp();

    const response = await app.request("/api/models");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [{ id: "zhipu/glm-4.5" }],
      count: 1,
    });
  });

  it("serves the dashboard over HTTP so it can call the same-origin database API", async () => {
    const { createApp } = await import("./app.js");
    const app = createApp();

    const response = await app.request("/models/dashboard");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("MiniRouter");
    expect(html).toContain("/api/models");
  });

  it("serves the admin dashboard shell so it can collect an admin token", async () => {
    const { createApp } = await import("./app.js");
    const app = createApp();

    const response = await app.request("/admin/dashboard");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("MiniRouter Admin");
    expect(html).toContain("Users");
    expect(html).toContain("Provider Channels");
    expect(html).toContain("Usage Logs");
  });
});
