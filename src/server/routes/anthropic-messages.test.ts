import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { materializeLocalMediaReferences, materializeLocalMediaReferencesWithDiagnostics } from "../../providers/client-adapter.js";

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

