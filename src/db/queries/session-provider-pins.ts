/**
 * Session Provider Pin Queries
 *
 * Keeps a per-session, per-slot record of the last successful provider
 * instance. Subsequent requests in the same conversation prefer the pinned
 * provider, only falling back when it fails or is unhealthy/cooling down.
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../connection.js";
import { sessionProviderPins } from "../schema.js";

export async function getSessionProviderPin(
  sessionId: string,
  slot: string,
): Promise<string | undefined> {
  const db = getDb();
  const row = await db
    .select({ providerInstanceId: sessionProviderPins.providerInstanceId })
    .from(sessionProviderPins)
    .where(
      and(
        eq(sessionProviderPins.sessionId, sessionId),
        eq(sessionProviderPins.slot, slot),
      ),
    )
    .limit(1);
  return row[0]?.providerInstanceId;
}

export async function setSessionProviderPin(
  sessionId: string,
  slot: string,
  providerInstanceId: string,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .insert(sessionProviderPins)
    .values({
      sessionId,
      slot,
      providerInstanceId,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: [sessionProviderPins.sessionId, sessionProviderPins.slot],
      set: {
        providerInstanceId,
        lastUsedAt: now,
      },
    });
}

export async function clearSessionProviderPin(
  sessionId: string,
  slot: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(sessionProviderPins)
    .where(
      and(
        eq(sessionProviderPins.sessionId, sessionId),
        eq(sessionProviderPins.slot, slot),
      ),
    );
}
