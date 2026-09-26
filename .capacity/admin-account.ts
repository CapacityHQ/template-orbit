// Capacity: creates the admin account when the database has no user at all.
// Runs locally as the `admin-account` setup command (once per project, safe to
// re-run) and in the image at every container start, between the migrations
// and the gateway. Never touches an existing account, and does not validate
// the two variables once a user exists: a stale or edited value in the
// Production list must not stop the site from starting. Once the admin changed
// their password in Orbit, these variables only matter again for a database
// that lost every user.
import { randomUUID } from 'node:crypto';
import { uniqueHandleFor } from '../apps/web/src/lib/auth/handle.ts';
import { hashPassword } from '../apps/web/src/lib/auth/password.ts';
import {
  count,
  type Database,
  db,
  inArray,
  pool,
  schema,
  sql,
  type Transaction,
} from '../packages/db/src/index.ts';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../packages/shared/src/validators/auth.ts';
import { emailSchema } from '../packages/shared/src/validators/common.ts';

// Distinct from migration-release.ts's lock; two containers starting together
// serialize here so only one of them inserts.
const LOCK_KEY = 7_311_942_006_031_001;

const email = (process.env['ORBIT_ADMIN_EMAIL'] ?? '').trim().toLowerCase();
const password = process.env['ORBIT_ADMIN_PASSWORD'] ?? '';

async function userCount(executor: Database | Transaction): Promise<number> {
  const [row] = await executor.select({ users: count() }).from(schema.user);
  return row?.users ?? 0;
}

function alreadyHasUsers(users: number): string {
  return `Admin account not created: the database already has ${users} user${users === 1 ? '' : 's'}.`;
}

function invalidInput(): string | null {
  if (!emailSchema.safeParse(email).success) {
    return 'Admin account not created: ORBIT_ADMIN_EMAIL is not a valid email address.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Admin account not created: ORBIT_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Admin account not created: ORBIT_ADMIN_PASSWORD must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

async function main(): Promise<number> {
  if (email.length === 0 || password.length === 0) {
    console.info('Admin account skipped: ORBIT_ADMIN_EMAIL or ORBIT_ADMIN_PASSWORD is empty.');
    return 0;
  }
  const existing = await userCount(db);
  if (existing > 0) {
    console.info(alreadyHasUsers(existing));
    return 0;
  }
  const invalid = invalidInput();
  if (invalid !== null) {
    console.error(invalid);
    return 1;
  }
  const message = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    const users = await userCount(tx);
    if (users > 0) return alreadyHasUsers(users);
    const name = email.slice(0, email.indexOf('@'));
    const handle = await uniqueHandleFor(email, name, async (candidates) => {
      const taken = await tx
        .select({ handle: schema.user.handle })
        .from(schema.user)
        .where(inArray(schema.user.handle, [...candidates]));
      return new Set(taken.map((t) => t.handle));
    });
    const userId = randomUUID();
    await tx.insert(schema.user).values({ id: userId, name, email, emailVerified: true, handle });
    await tx.insert(schema.account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: await hashPassword(password),
    });
    return `Admin account created: ${email}`;
  });
  console.info(message);
  return 0;
}

const code = await main().catch((error: unknown) => {
  console.error(`Admin account failed: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
await pool.end();
process.exit(code);
