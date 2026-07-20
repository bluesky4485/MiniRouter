import { describe, expect, it } from "vitest";
import { selectProviderChannel } from "./channels.js";
import type { ProviderChannel } from "./channels.js";

function channel(overrides: Partial<ProviderChannel>): ProviderChannel {
  return {
    id: overrides.id ?? "channel-a",
    slot: overrides.slot ?? "balanced",
    provider: overrides.provider ?? "example",
    providerKind: overrides.providerKind ?? "openai-compatible",
    baseUrl: overrides.baseUrl ?? "https://api.example.com/v1",
    apiKey: overrides.apiKey ?? "secret",
    model: overrides.model ?? "example-model",
    weight: overrides.weight ?? 1,
    supportsTools: overrides.supportsTools ?? true,
    supportsVision: overrides.supportsVision ?? false,
    isHealthy: overrides.isHealthy ?? true,
    cooldownUntil: overrides.cooldownUntil,
  };
}

describe("selectProviderChannel", () => {
  it("filters unhealthy, cooling down, and capability-incompatible channels", () => {
    const selected = selectProviderChannel(
      [
        channel({ id: "unhealthy", isHealthy: false }),
        channel({ id: "cooldown", cooldownUntil: "2999-01-01T00:00:00.000Z" }),
        channel({ id: "no-tools", supportsTools: false }),
        channel({ id: "eligible" }),
      ],
      {
        slot: "balanced",
        requirements: { toolCalling: true, vision: false },
        cursor: 0,
        now: new Date("2026-07-07T00:00:00.000Z"),
      },
    );

    expect(selected?.channel.id).toBe("eligible");
  });

  it("uses weighted-primary strategy by default (highest weight first)", () => {
    const channels = [
      channel({ id: "a", weight: 3 }),
      channel({ id: "b", weight: 1 }),
      channel({ id: "c", weight: 2 }),
    ];

    expect(selectProviderChannel(channels, {
      slot: "balanced",
      requirements: { toolCalling: false, vision: false },
      cursor: 0,
      now: new Date("2026-07-07T00:00:00.000Z"),
    })?.channel.id).toBe("a");

    // Cursor is ignored in weighted-primary mode.
    expect(selectProviderChannel(channels, {
      slot: "balanced",
      requirements: { toolCalling: false, vision: false },
      cursor: 99,
      now: new Date("2026-07-07T00:00:00.000Z"),
    })?.channel.id).toBe("a");
  });

  it("prefers the pinned provider when it is eligible", () => {
    const channels = [
      channel({ id: "a", weight: 5 }),
      channel({ id: "b", weight: 1 }),
    ];

    const selected = selectProviderChannel(channels, {
      slot: "balanced",
      requirements: { toolCalling: false, vision: false },
      cursor: 0,
      now: new Date("2026-07-07T00:00:00.000Z"),
      pinnedProviderId: "b",
    });

    expect(selected?.channel.id).toBe("b");
  });

  it("falls back to weighted-primary when pinned provider is ineligible", () => {
    const channels = [
      channel({ id: "a", weight: 5 }),
      channel({ id: "b", weight: 1, isHealthy: false }),
    ];

    const selected = selectProviderChannel(channels, {
      slot: "balanced",
      requirements: { toolCalling: false, vision: false },
      cursor: 0,
      now: new Date("2026-07-07T00:00:00.000Z"),
      pinnedProviderId: "b",
    });

    expect(selected?.channel.id).toBe("a");
  });

  it("uses weighted round-robin when strategy is round-robin", () => {
    const channels = [
      channel({ id: "a", weight: 2 }),
      channel({ id: "b", weight: 1 }),
    ];

    expect(selectProviderChannel(channels, {
      slot: "balanced",
      requirements: { toolCalling: false, vision: false },
      cursor: 0,
      strategy: "round-robin",
      now: new Date("2026-07-07T00:00:00.000Z"),
    })?.channel.id).toBe("a");
    expect(selectProviderChannel(channels, {
      slot: "balanced",
      requirements: { toolCalling: false, vision: false },
      cursor: 1,
      strategy: "round-robin",
      now: new Date("2026-07-07T00:00:00.000Z"),
    })?.channel.id).toBe("a");
    expect(selectProviderChannel(channels, {
      slot: "balanced",
      requirements: { toolCalling: false, vision: false },
      cursor: 2,
      strategy: "round-robin",
      now: new Date("2026-07-07T00:00:00.000Z"),
    })?.channel.id).toBe("b");
  });
});
