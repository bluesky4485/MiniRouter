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
