import { asc, db, eq, schema, sql } from '@orbit/db';
import { inviteOnly } from '@/lib/env.ts';

export async function hasAnyAccount(): Promise<boolean> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  return rows.length > 0;
}

export async function accountExists(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(sql`lower(${schema.user.email})`, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

export async function canCreateWorkspace(userId: string): Promise<boolean> {
  if (!inviteOnly()) return true;
  const [oldest] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt), asc(schema.user.id))
    .limit(1);
  return oldest?.id === userId;
}
