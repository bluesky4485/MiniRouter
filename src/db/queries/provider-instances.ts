import { desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "../../auth/uuid.js";
import { getDb } from "../connection.js";
import { providerInstances } from "../schema.js";
import type { ModelSlot, ModelSlotName, ProviderKind } from "../../providers/types.js";
import type { ProviderChannel } from "../../providers/channels.js";

type ProviderInstanceRow = typeof providerInstances.$inferSelect;

export type UpsertProviderInstanceInput = {
  id?: string;
  slot: ModelSlotName;
  provider: string;
  providerKind: ProviderKind;
  endpointUrl: string;
  apiKey: string;
  modelId: string;
  pricingModelId?: string | null;
  weight?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  contextWindowTokens?: number;
  isHealthy?: boolean;
  cooldownUntil?: string | null;
  notes?: string | null;
};

export function mapProviderInstanceRow(row: ProviderInstanceRow): ProviderChannel {
  return {
    id: row.id,
    slot: row.slot as ModelSlotName,
    provider: row.provider,
    providerKind: row.providerKind as ProviderKind,
    baseUrl: row.endpointUrl,
    apiKey: row.apiKey ?? "",
    model: row.modelId,
    pricingModelId: row.pricingModelId ?? undefined,
    weight: Number(row.weight ?? 1),
    supportsTools: !!row.supportsTools,
    supportsVision: !!row.supportsVision,
    isHealthy: !!row.isHealthy,
    cooldownUntil: row.cooldownUntil,
    contextWindowTokens: row.contextWindowTokens ?? undefined,
  };
}

export function channelToModelSlot(channel: ProviderChannel): ModelSlot {
  return {
    slot: channel.slot,
    provider: channel.providerKind,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    model: channel.model,
    pricingModelId: channel.pricingModelId,
    supportsTools: channel.supportsTools,
    supportsVision: channel.supportsVision,
    contextWindowTokens: channel.contextWindowTokens,
    providerInstanceId: channel.id,
  };
}

export async function listProviderInstances(slot?: ModelSlotName): Promise<ProviderChannel[]> {
  const db = getDb();
  const rows = slot
    ? await db.select().from(providerInstances).where(eq(providerInstances.slot, slot)).orderBy(desc(providerInstances.createdAt))
    : await db.select().from(providerInstances).orderBy(desc(providerInstances.createdAt));
  return rows.map(mapProviderInstanceRow);
}

export async function createProviderInstance(input: UpsertProviderInstanceInput): Promise<ProviderChannel> {
  const db = getDb();
  const id = input.id ?? uuidv7();
  const now = new Date().toISOString();
  await db.insert(providerInstances).values({
    id,
    slot: input.slot,
    provider: input.provider,
    providerKind: input.providerKind,
    endpointUrl: input.endpointUrl,
    apiKey: input.apiKey,
    modelId: input.modelId,
    pricingModelId: input.pricingModelId ?? null,
    weight: input.weight ?? 1,
    supportsTools: input.supportsTools === false ? 0 : 1,
    supportsVision: input.supportsVision ? 1 : 0,
    contextWindowTokens: input.contextWindowTokens ?? null,
    isHealthy: input.isHealthy === false ? 0 : 1,
    cooldownUntil: input.cooldownUntil ?? null,
    notes: input.notes ?? null,
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db.select().from(providerInstances).where(eq(providerInstances.id, id)).limit(1);
  return mapProviderInstanceRow(rows[0]);
}

export async function updateProviderInstance(
  id: string,
  input: Partial<UpsertProviderInstanceInput>,
): Promise<ProviderChannel | undefined> {
  const db = getDb();
  const updates: Partial<typeof providerInstances.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.slot) updates.slot = input.slot;
  if (input.provider) updates.provider = input.provider;
  if (input.providerKind) updates.providerKind = input.providerKind;
  if (input.endpointUrl) updates.endpointUrl = input.endpointUrl;
  if (input.apiKey !== undefined) updates.apiKey = input.apiKey;
  if (input.modelId) updates.modelId = input.modelId;
  if (input.pricingModelId !== undefined) updates.pricingModelId = input.pricingModelId;
  if (input.weight !== undefined) updates.weight = input.weight;
  if (input.supportsTools !== undefined) updates.supportsTools = input.supportsTools ? 1 : 0;
  if (input.supportsVision !== undefined) updates.supportsVision = input.supportsVision ? 1 : 0;
  if (input.contextWindowTokens !== undefined) updates.contextWindowTokens = input.contextWindowTokens;
  if (input.isHealthy !== undefined) updates.isHealthy = input.isHealthy ? 1 : 0;
  if (input.cooldownUntil !== undefined) updates.cooldownUntil = input.cooldownUntil;
  if (input.notes !== undefined) updates.notes = input.notes;

  await db.update(providerInstances).set(updates).where(eq(providerInstances.id, id));
  const rows = await db.select().from(providerInstances).where(eq(providerInstances.id, id)).limit(1);
  return rows[0] ? mapProviderInstanceRow(rows[0]) : undefined;
}

export async function disableProviderInstance(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(providerInstances)
    .set({ isHealthy: 0, updatedAt: new Date().toISOString() })
    .where(eq(providerInstances.id, id));
}

export async function deleteProviderInstance(id: string): Promise<void> {
  const db = getDb();
  await db.delete(providerInstances).where(eq(providerInstances.id, id));
}

export async function recordProviderSuccess(id: string, latencyMs: number): Promise<void> {
  const db = getDb();
  await db
    .update(providerInstances)
    .set({
      consecutiveFailures: 0,
      isHealthy: 1,
      lastUsedAt: new Date().toISOString(),
      lastHealthCheck: new Date().toISOString(),
      avgLatencyMs: latencyMs,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(providerInstances.id, id));
}

export async function recordProviderFailure(id: string, options: { cooldownMs?: number } = {}): Promise<void> {
  const db = getDb();
  const cooldownUntil = new Date(Date.now() + (options.cooldownMs ?? 60_000)).toISOString();
  await db
    .update(providerInstances)
    .set({
      consecutiveFailures: 1,
      cooldownUntil,
      lastHealthCheck: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(providerInstances.id, id));
}
