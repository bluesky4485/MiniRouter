/**
 * Channel failover execution
 *
 * Picks a healthy provider channel for a slot and executes the upstream
 * request. If the chosen channel fails (throws, or returns a non-2xx
 * response), it records the failure and retries with *another* healthy
 * channel in the same slot — until one succeeds or every channel has been
 * tried. This gives per-request failover / load-balancing across channels
 * sharing a slot, instead of failing the whole request on the first bad
 * channel.
 */

import type { ModelSlot, ModelSlotName } from "../../providers/types.js";
import { selectProviderChannel } from "../../providers/channels.js";
import {
  channelToModelSlot,
  listProviderInstances,
  recordProviderFailure,
  recordProviderSuccess,
} from "../../db/queries/provider-instances.js";

/** Per-slot round-robin cursor, shared across chat + anthropic routes. */
export const channelCursors = new Map<string, number>();

export type ChannelExecutor<T> = (slot: ModelSlot) => Promise<{
  upstream: Response;
  optimization: T;
}>;

export type ChannelExecutionResult<T> = {
  slot: ModelSlot;
  upstream: Response;
  optimization: T;
};

/**
 * Execute `executor` against channels of `slot`, failing over to other
 * healthy channels on error.
 *
 * A channel is considered failed when the executor throws OR returns a
 * non-ok response. Either way we record the failure (so a brief cooldown
 * also protects subsequent requests) and move on to the next candidate.
 * All channels exhausted without success throws — callers should map that
 * to a 502 / provider-error response.
 */
export async function executeWithChannelFallback<T>(opts: {
  slot: ModelSlotName;
  requirements: { toolCalling: boolean; vision: boolean };
  executor: ChannelExecutor<T>;
  now?: Date;
  maxAttempts?: number;
  protocol?: 'openai-chat' | 'anthropic-messages';
}): Promise<ChannelExecutionResult<T>> {
  const { slot: slotName, requirements, executor, now } = opts;
  const channels = await listProviderInstances(slotName);
  const tried = new Set<string>();
  const maxAttempts = opts.maxAttempts ?? Math.max(1, channels.length);
  const startedAt = Date.now();

  let lastUpstream: Response | undefined;
  let lastSlot: ModelSlot | undefined;
  let lastOptimization: T | undefined;

  for (let attempt = 0; attempt < maxAttempts && tried.size < channels.length; attempt++) {
    const selection = selectProviderChannel(channels, {
      slot: slotName,
      requirements,
      cursor: channelCursors.get(slotName) ?? 0,
      now,
      excludeIds: [...tried],
      protocol: opts.protocol,
    });
    if (!selection) break;

    channelCursors.set(slotName, selection.nextCursor);
    const selectedSlot = channelToModelSlot(selection.channel);
    tried.add(selection.channel.id);

    try {
      const result = await executor(selectedSlot);
      if (result.upstream.ok) {
        if (selectedSlot.providerInstanceId) {
          await recordProviderSuccess(selectedSlot.providerInstanceId, Date.now() - startedAt);
        }
        return { slot: selectedSlot, upstream: result.upstream, optimization: result.optimization };
      }
      if (selectedSlot.providerInstanceId) {
        await recordProviderFailure(selectedSlot.providerInstanceId);
      }
      lastUpstream = result.upstream;
      lastSlot = selectedSlot;
      lastOptimization = result.optimization;
    } catch {
      if (selectedSlot.providerInstanceId) {
        await recordProviderFailure(selectedSlot.providerInstanceId);
      }
      lastUpstream = undefined;
      lastSlot = selectedSlot;
      lastOptimization = undefined;
    }
  }

  if (lastUpstream && lastSlot) {
    return { slot: lastSlot, upstream: lastUpstream, optimization: lastOptimization ?? ({} as T) };
  }
  const hasChannels = channels.length > 0;
  if (hasChannels && opts.protocol) {
    throw new Error(
      `No provider channel for slot "${slotName}" can serve protocol ${opts.protocol}. ` +
      `Check that channels registered for this slot have a matching providerKind (anthropic vs openai-compatible).`,
    );
  }
  throw new Error(`all provider channels failed for slot: ${slotName}`);
}
