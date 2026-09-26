import { beforeEach, describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resetDatabase } from '@orbit/core/test-support';
import { count, db, eq, schema } from '@orbit/db';
import { verifyPassword } from '@/lib/auth/password.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const EMAIL = 'admin@example.test';
const PASSWORD = 'twelve-characters-long';
const ADMIN_ACCOUNT_ARGS = ['--import', 'tsx', '.capacity/admin-account.ts'];

function adminAccountEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ORBIT_ADMIN_EMAIL: '', ORBIT_ADMIN_PASSWORD: '', ...env };
}

function runAdminAccount(env: Record<string, string>): { status: number | null; output: string } {
  const result = spawnSync('node', ADMIN_ACCOUNT_ARGS, {
    cwd: ROOT,
    env: adminAccountEnv(env),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function runAdminAccountAsync(
  env: Record<string, string>,
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('node', ADMIN_ACCOUNT_ARGS, { cwd: ROOT, env: adminAccountEnv(env) });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('.capacity/admin-account.ts did not exit within 60s'));
    }, 60_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolvePromise({ status, output });
    });
  });
}

async function users(): Promise<number> {
  const [row] = await db.select({ users: count() }).from(schema.user);
  return row?.users ?? 0;
}

async function accounts(): Promise<number> {
  const [row] = await db.select({ accounts: count() }).from(schema.account);
  return row?.accounts ?? 0;
}

describe('.capacity/admin-account.ts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates the admin once: a verified user named after the local part, a credential account with an argon2id hash', async () => {
    const first = runAdminAccount({
      ORBIT_ADMIN_EMAIL: 'Admin@Example.TEST',
      ORBIT_ADMIN_PASSWORD: PASSWORD,
    });
    expect(first.status).toBe(0);
    expect(first.output).toContain(`Admin account created: ${EMAIL}`);

    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, EMAIL));
    expect(user).toBeDefined();
    expect(user?.name).toBe('admin');
    expect(user?.handle).toBe('admin');
    expect(user?.emailVerified).toBe(true);
    expect(user?.onboardingCompletedAt).toBeNull();

    const [account] = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, user!.id));
    expect(account?.providerId).toBe('credential');
    expect(account?.accountId).toBe(user!.id);
    expect(account?.password).toMatch(/^\$argon2id\$v=19\$m=65536,t=2,p=1\$/);
    expect(await verifyPassword(account?.password ?? '', PASSWORD)).toBe(true);
    expect(await verifyPassword(account?.password ?? '', 'not-the-password-123')).toBe(false);

    const second = runAdminAccount({
      ORBIT_ADMIN_EMAIL: EMAIL,
      ORBIT_ADMIN_PASSWORD: 'a-different-password-1',
    });
    expect(second.status).toBe(0);
    expect(second.output).toContain('Admin account not created: the database already has 1 user.');
    expect(await users()).toBe(1);

    const [accountAfter] = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, user!.id));
    expect(await verifyPassword(accountAfter?.password ?? '', PASSWORD)).toBe(true);
    expect(await verifyPassword(accountAfter?.password ?? '', 'a-different-password-1')).toBe(
      false,
    );
  }, 70_000);

  it('skips with exit 0 when either variable is empty', async () => {
    const missingPassword = runAdminAccount({ ORBIT_ADMIN_EMAIL: EMAIL });
    expect(missingPassword.status).toBe(0);
    expect(missingPassword.output).toContain('Admin account skipped');

    const missingEmail = runAdminAccount({ ORBIT_ADMIN_PASSWORD: PASSWORD });
    expect(missingEmail.status).toBe(0);
    expect(missingEmail.output).toContain('Admin account skipped');

    expect(await users()).toBe(0);
  }, 70_000);

  it('refuses a password shorter than 12 characters with exit 1', async () => {
    const result = runAdminAccount({ ORBIT_ADMIN_EMAIL: EMAIL, ORBIT_ADMIN_PASSWORD: 'short-pw' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('12 characters');
    expect(await users()).toBe(0);
  }, 70_000);

  it('refuses an invalid email address with exit 1', async () => {
    const result = runAdminAccount({
      ORBIT_ADMIN_EMAIL: 'not-an-email',
      ORBIT_ADMIN_PASSWORD: PASSWORD,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('not a valid email address');
    expect(await users()).toBe(0);
  }, 70_000);

  it('refuses a password longer than 128 characters with exit 1', async () => {
    const result = runAdminAccount({
      ORBIT_ADMIN_EMAIL: EMAIL,
      ORBIT_ADMIN_PASSWORD: 'a'.repeat(129),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('128 characters');
    expect(await users()).toBe(0);
  }, 70_000);

  it('starts with exit 0 when users exist, even if the variables are no longer valid', async () => {
    const first = runAdminAccount({ ORBIT_ADMIN_EMAIL: EMAIL, ORBIT_ADMIN_PASSWORD: PASSWORD });
    expect(first.status).toBe(0);
    expect(first.output).toContain('Admin account created');

    const edited = runAdminAccount({ ORBIT_ADMIN_EMAIL: EMAIL, ORBIT_ADMIN_PASSWORD: 'short-pw' });
    expect(edited.status).toBe(0);
    expect(edited.output).toContain('the database already has 1 user');
    expect(await users()).toBe(1);
  }, 70_000);

  it('lets only one of two concurrent starts create the admin (the advisory lock)', async () => {
    const env = { ORBIT_ADMIN_EMAIL: EMAIL, ORBIT_ADMIN_PASSWORD: PASSWORD };
    const [first, second] = await Promise.all([
      runAdminAccountAsync(env),
      runAdminAccountAsync(env),
    ]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    const outputs = [first.output, second.output];
    expect(outputs.filter((output) => output.includes('Admin account created')).length).toBe(1);
    expect(outputs.filter((output) => output.includes('Admin account not created')).length).toBe(1);

    expect(await users()).toBe(1);
    expect(await accounts()).toBe(1);
  }, 70_000);
});
