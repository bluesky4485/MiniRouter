import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderChannel } from "../../providers/channels.js";
import type { ChannelSelectionInput, ChannelSelection } from "../../providers/channels.js";
import type { ModelSlot, ModelSlotName } from "../../providers/types.js";

const {
  mockListProviderInstances,
  mockRecordProviderFailure,
  mockRecordProviderSuccess,
  mockSelectProviderChannel,
  mockChannelToModelSlot,
} = vi.hoisted(() => ({
  mockListProviderInstances: vi.fn(),
  mockRecordProviderFailure: vi.fn(),
  mockRecordProviderSuccess: vi.fn(),
  mockSelectProviderChannel: vi.fn(),
  mockChannelToModelSlot: (ch: ProviderChannel): ModelSlot => ({
    slot: ch.slot,
    provider: ch.providerKind,
    baseUrl: ch.baseUrl,
    apiKey: ch.apiKey,
    model: ch.model,
    pricingModelId: ch.pricingModelId,
    supportsTools: ch.supportsTools,
    supportsVision: ch.supportsVision,
    contextWindowTokens: ch.contextWindowTokens,
    providerInstanceId: ch.id,
  }),
}));

vi.mock("../../db/queries/provider-instances.js", () => ({
  channelToModelSlot: mockChannelToModelSlot,
  listProviderInstances: mockListProviderInstances,
  recordProviderFailure: mockRecordProviderFailure,
  recordProviderSuccess: mockRecordProviderSuccess,
}));

vi.mock("../../providers/channels.js", () => ({
  selectProviderChannel: mockSelectProviderChannel,
}));

import { executeWithChannelFallback, channelCursors } from "./channel-execution.js";

function makeChannel(id: string, model = "m"): ProviderChannel {
  return {
    id,
    slot: "fast",
    provider: "p",
    providerKind: "openai-compatible",
    baseUrl: "https://x",
    apiKey: "k",
    model,
    pricingModelId: undefined,
    weight: 1,
    supportsTools: true,
    supportsVision: false,
    isHealthy: true,
    cooldownUntil: null,
  };
}

function okResponse() {
  return new Response("ok", { status: 200 });
}
function badResponse() {
  return new Response("bad", { status: 500 });
}

/** Pick the first channel not yet tried, mimicking the real round-robin. */
function pickNext(channels: ProviderChannel[], input: ChannelSelectionInput): ChannelSelection | undefined {
  const next = channels.find((c) => !input.excludeIds?.includes(c.id));
  return next ? { channel: next, nextCursor: 1 } : undefined;
}

afterEach(() => {
  channelCursors.clear();
  vi.clearAllMocks();
});

describe("executeWithChannelFallback", () => {
  it("returns the first channel when it succeeds", async () => {
    const channels = [makeChannel("a"), makeChannel("b")];
    mockListProviderInstances.mockResolvedValue(channels);
    mockSelectProviderChannel.mockImplementation((chs: ProviderChannel[], input: ChannelSelectionInput) => pickNext(chs, input));

    const executor = vi.fn(async () => ({ upstream: okResponse(), optimization: {} }));
    const result = await executeWithChannelFallback({ slot: "fast" as ModelSlotName, requirements: { toolCalling: true, vision: false }, executor });

    expect(result.slot.providerInstanceId).toBe("a");
    expect(executor).toHaveBeenCalledTimes(1);
    expect(mockRecordProviderSuccess).toHaveBeenCalledWith("a", expect.any(Number));
    expect(mockRecordProviderFailure).not.toHaveBeenCalled();
  });

  it("fails over to the next channel when the first returns a non-2xx", async () => {
    const channels = [makeChannel("a"), makeChannel("b")];
    mockListProviderInstances.mockResolvedValue(channels);
    mockSelectProviderChannel.mockImplementation((chs: ProviderChannel[], input: ChannelSelectionInput) => pickNext(chs, input));

    const executor = vi
      .fn()
      .mockResolvedValueOnce({ upstream: badResponse(), optimization: {} })
      .mockResolvedValueOnce({ upstream: okResponse(), optimization: { reason: "r" } });

    const result = await executeWithChannelFallback({ slot: "fast" as ModelSlotName, requirements: { toolCalling: false, vision: false }, executor });

    expect(result.slot.providerInstanceId).toBe("b");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(mockRecordProviderFailure).toHaveBeenCalledWith("a");
    expect(mockRecordProviderSuccess).toHaveBeenCalledWith("b", expect.any(Number));
  });

  it("fails over when the first channel throws", async () => {
    const channels = [makeChannel("a"), makeChannel("b")];
    mockListProviderInstances.mockResolvedValue(channels);
    mockSelectProviderChannel.mockImplementation((chs: ProviderChannel[], input: ChannelSelectionInput) => pickNext(chs, input));

    const executor = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ upstream: okResponse(), optimization: {} });

    const result = await executeWithChannelFallback({ slot: "fast" as ModelSlotName, requirements: { toolCalling: false, vision: false }, executor });
    expect(result.slot.providerInstanceId).toBe("b");
    expect(mockRecordProviderFailure).toHaveBeenCalledWith("a");
  });

  it("returns the last bad upstream when every channel returns a non-2xx", async () => {
    const channels = [makeChannel("a"), makeChannel("b")];
    mockListProviderInstances.mockResolvedValue(channels);
    mockSelectProviderChannel.mockImplementation((chs: ProviderChannel[], input: ChannelSelectionInput) => pickNext(chs, input));

    const executor = vi.fn(async () => ({ upstream: badResponse(), optimization: {} }));
    const result = await executeWithChannelFallback({ slot: "fast" as ModelSlotName, requirements: { toolCalling: false, vision: false }, executor });
    expect(result.upstream.status).toBe(500);
    expect(result.slot.providerInstanceId).toBe("b");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(mockRecordProviderFailure).toHaveBeenCalledWith("a");
    expect(mockRecordProviderFailure).toHaveBeenCalledWith("b");
  });

  it("throws only when every channel call throws (no response at all)", async () => {
    const channels = [makeChannel("a"), makeChannel("b")];
    mockListProviderInstances.mockResolvedValue(channels);
    mockSelectProviderChannel.mockImplementation((chs: ProviderChannel[], input: ChannelSelectionInput) => pickNext(chs, input));

    const executor = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(
      executeWithChannelFallback({ slot: "fast" as ModelSlotName, requirements: { toolCalling: false, vision: false }, executor }),
    ).rejects.toThrow(/all provider channels failed/);
    expect(executor).toHaveBeenCalledTimes(2);
  });
});
