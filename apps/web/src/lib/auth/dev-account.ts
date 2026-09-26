import { and, db, eq, schema, sql } from '@orbit/db';
import { verifyPassword } from './password.ts';

export interface DevAccount {
  readonly email: string;
  readonly password: string;
}

export async function devAccountPrefill(): Promise<DevAccount | null> {
  if (process.env.NODE_ENV !== 'development') return null;
  const email = (process.env['ORBIT_ADMIN_EMAIL'] ?? '').trim().toLowerCase();
  const password = process.env['ORBIT_ADMIN_PASSWORD'] ?? '';
  if (email.length === 0 || password.length === 0) return null;
  const [row] = await db
    .select({ hash: schema.account.password })
    .from(schema.account)
    .innerJoin(schema.user, eq(schema.user.id, schema.account.userId))
    .where(
      and(eq(sql`lower(${schema.user.email})`, email), eq(schema.account.providerId, 'credential')),
    )
    .limit(1);
  if (row?.hash == null) return null;
  return (await verifyPassword(row.hash, password)) ? { email, password } : null;
}
