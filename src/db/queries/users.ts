/**
 * User CRUD Queries
 */

import { getDb } from "../connection.js";
import { users } from "../schema.js";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "../../auth/uuid.js";

export interface CreateUserInput {
  email: string;
  name?: string;
  routingProfile?: "eco" | "auto" | "premium";
  role?: "user" | "admin" | "superadmin";
  rateLimitRpm?: number;
  rateLimitRpd?: number;
  spendLimitDailyUsd?: number | null;
  spendLimitMonthlyUsd?: number | null;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  routingProfile: string;
  routingStrategy: string;
  role: string;
  isActive: number;
  spendLimitDailyUsd: number | null;
  spendLimitMonthlyUsd: number | null;
  createdAt: string;
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const db = getDb();
  const id = uuidv7();
  const now = new Date().toISOString();

  await db.insert(users).values({
    id,
    email: input.email.toLowerCase().trim(),
    name: input.name ?? null,
    routingProfile: input.routingProfile ?? "auto",
    routingStrategy: "rules",
    rateLimitRpm: input.rateLimitRpm ?? 60,
    rateLimitRpd: input.rateLimitRpd ?? 10000,
    spendLimitDailyUsd: input.spendLimitDailyUsd ?? null,
    spendLimitMonthlyUsd: input.spendLimitMonthlyUsd ?? null,
    role: input.role ?? "user",
    isActive: 1,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] as UserRecord;
}

export async function getUserById(id: string): Promise<UserRecord | undefined> {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] as UserRecord | undefined;
}

export async function getUserByEmail(email: string): Promise<UserRecord | undefined> {
  const db = getDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);
  return result[0] as UserRecord | undefined;
}

export async function listUsers(limit = 50, offset = 0): Promise<UserRecord[]> {
  const db = getDb();
  return db.select().from(users).limit(limit).offset(offset) as Promise<UserRecord[]>;
}

export interface UpdateUserInput {
  name?: string | null;
  routingProfile?: "eco" | "auto" | "premium";
  role?: "user" | "admin" | "superadmin";
  isActive?: boolean;
  rateLimitRpm?: number | null;
  rateLimitRpd?: number | null;
  spendLimitDailyUsd?: number | null;
  spendLimitMonthlyUsd?: number | null;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserRecord | undefined> {
  const db = getDb();
  const updates: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (input.name !== undefined) updates.name = input.name;
  if (input.routingProfile !== undefined) updates.routingProfile = input.routingProfile;
  if (input.role !== undefined) updates.role = input.role;
  if (input.isActive !== undefined) updates.isActive = input.isActive ? 1 : 0;
  if (input.rateLimitRpm !== undefined) updates.rateLimitRpm = input.rateLimitRpm;
  if (input.rateLimitRpd !== undefined) updates.rateLimitRpd = input.rateLimitRpd;
  if (input.spendLimitDailyUsd !== undefined) updates.spendLimitDailyUsd = input.spendLimitDailyUsd;
  if (input.spendLimitMonthlyUsd !== undefined) updates.spendLimitMonthlyUsd = input.spendLimitMonthlyUsd;

  await db.update(users).set(updates).where(eq(users.id, id));
  return getUserById(id);
}
