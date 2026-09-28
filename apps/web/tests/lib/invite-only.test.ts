import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInvite } from '@orbit/core';
import { createUser, createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { count, db, eq, schema } from '@orbit/db';
import { POST as authPost } from '@/app/api/auth/[...all]/route.ts';
import { accountExists, canCreateWorkspace, hasAnyAccount } from '@/lib/auth/first-account.ts';
import { hashPassword } from '@/lib/auth/password.ts';
import { assertInvited, assertSignInCodeAllowed, auth } from '@/lib/auth/server.ts';
import { inviteOnly, signUpIsOpen } from '@/lib/env.ts';
import { nativeFetchGlobals } from '../../tests-preload.ts';
import { restoreModulesAfterThisFile } from '../../tests-support.ts';

const APP_ORIGIN = 'http://localhost:3000';
const INVITATION_REQUIRED = /invitation-only/;
const ROOT = resolve(import.meta.dir, '../../../..');
const SIGN_UP_DISABLED = /EMAIL_PASSWORD_SIGN_UP_DISABLED/;
const OWNER = 'owner@example.test';
const PASSWORD = 'twelve-characters-long';

let requestCookie = '';
await restoreModulesAfterThisFile(['next/headers']);
mock.module('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ cookie: requestCookie })),
}));
const { POST: setPassword } = await import('@/app/api/account/password/route.ts');

async function withNativeFetchGlobals<T>(operation: () => Promise<T>): Promise<T> {
  const domFetchGlobals = {
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
  };
  Object.assign(globalThis, nativeFetchGlobals);
  try {
    return await operation();
  } finally {
    Object.assign(globalThis, domFetchGlobals);
  }
}

function authRequest(path: string, body: unknown, cookie = ''): Request {
  return new Request(`${APP_ORIGIN}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN, cookie },
    body: JSON.stringify(body),
  });
}

async function withEmailConfigured<T>(operation: () => Promise<T>): Promise<T> {
  const names = ['RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_BASE_URL'] as const;
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env['RESEND_API_KEY'] = 're_test_not_a_real_key';
  process.env['EMAIL_FROM'] = 'Orbit <auth@example.com>';
  process.env['RESEND_BASE_URL'] = 'http://127.0.0.1:9';
  try {
    return await operation();
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function userCount(): Promise<number> {
  const [row] = await db.select({ users: count() }).from(schema.user);
  return row?.users ?? 0;
}

async function verificationRows(): Promise<number> {
  const [row] = await db.select({ rows: count() }).from(schema.verification);
  return row?.rows ?? 0;
}

async function deliveries(): Promise<number> {
  const [row] = await db.select({ rows: count() }).from(schema.emailDelivery);
  return row?.rows ?? 0;
}

function isDeclaredAndRequired(envExample: string, name: string): boolean {
  const lines = envExample.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index === -1) return false;
  return lines[index - 1]?.trim() !== '# required: false';
}

async function createPasswordUser(email: string, password: string): Promise<void> {
  const userId = randomUUID();
  await db.insert(schema.user).values({
    id: userId,
    name: 'Owner',
    email,
    emailVerified: true,
    handle: `owner-${userId.slice(0, 8)}`,
  });
  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(password),
  });
}

function createHook() {
  const before = auth.options.databaseHooks?.user?.create?.before;
  if (before === undefined) throw new Error('the user create hook is missing');
  return (email: string) =>
    before({
      id: 'user_1',
      name: 'Someone',
      email,
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((header) => header.split(';', 1)[0] ?? '')
    .join('; ');
}

async function signUpByCode(
  email: string,
  password: string,
): Promise<{ signIn: Response; password: Response }> {
  const requested = await withEmailConfigured(() =>
    authPost(authRequest('email-otp/send-verification-otp', { email, type: 'sign-in' })),
  );
  expect(requested.status).toBe(200);
  const otp = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } });
  const signIn = await authPost(authRequest('sign-in/email-otp', { email, otp }));
  requestCookie = cookieOf(signIn);
  const saved = await setPassword(
    new Request(`${APP_ORIGIN}/api/account/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: password }),
    }),
  );
  return { signIn, password: saved };
}

describe('invitation-only sign-up, first account included', () => {
  beforeEach(async () => {
    await resetDatabase();
    requestCookie = '';
  });

  it('runs with the template defaults (the runner copies .env.example to .env)', () => {
    expect(process.env['ORBIT_INVITE_ONLY']).toBe('true');
    expect(process.env['ORBIT_PASSWORD_AUTH']).toBe('true');
    expect(process.env['ORBIT_DEV_LOGIN']).toBe('0');
    expect(inviteOnly()).toBe(true);
    expect(signUpIsOpen()).toBe(false);

    const envExample = readFileSync(resolve(ROOT, '.env.example'), 'utf8');
    for (const name of ['RESEND_API_KEY', 'EMAIL_FROM']) {
      expect(isDeclaredAndRequired(envExample, name)).toBe(true);
    }
    expect(envExample).not.toContain('ORBIT_ADMIN_');
    expect(envExample).toContain(
      '# Filled by the project creation funnel. Sign-up codes and invitations are emailed through Resend.',
    );

    const runtime = JSON.parse(readFileSync(resolve(ROOT, '.capacity/runtime.json'), 'utf8')) as {
      setup: { id: string }[];
    };
    expect(runtime.setup.map((step) => step.id)).toEqual(['db-release', 'bucket']);
    const dockerfile = readFileSync(resolve(ROOT, '.capacity/Dockerfile'), 'utf8');
    expect(dockerfile).toContain('node apps/web/migrate.mjs && exec node apps/web/gateway.mjs');
    expect(dockerfile).not.toContain('admin-account');
  });

  it('admits any address while the database has no account', async () => {
    expect(await hasAnyAccount()).toBe(false);
    await expect(assertInvited('anyone@example.test')).resolves.toBeUndefined();
    await expect(assertSignInCodeAllowed('anyone@example.test')).resolves.toBeUndefined();
    await expect(createHook()('anyone@example.test')).resolves.toBeDefined();
  });

  it('once an account exists, refuses a stranger and admits an invited address, case-insensitively', async () => {
    const workspace = await createWorkspace('Nova');
    expect(await hasAnyAccount()).toBe(true);
    await expect(assertInvited('stranger@example.test')).rejects.toThrow(INVITATION_REQUIRED);
    await expect(assertSignInCodeAllowed('stranger@example.test')).rejects.toThrow(
      INVITATION_REQUIRED,
    );
    await expect(createHook()('stranger@example.test')).rejects.toThrow(INVITATION_REQUIRED);
    await expect(assertSignInCodeAllowed(workspace.adminUser.email)).resolves.toBeUndefined();

    await createInvite(workspace.admin, {
      email: 'invited@example.test',
      role: 'member',
      teamIds: [workspace.teamId],
    });
    await expect(assertInvited('Invited@Example.test')).resolves.toBeUndefined();
    await expect(createHook()('Invited@Example.test')).resolves.toBeDefined();
    expect(await accountExists(workspace.adminUser.email.toUpperCase())).toBe(true);
    expect(await accountExists('invited@example.test')).toBe(false);
  });

  it('refuses an address whose invitation has expired', async () => {
    const workspace = await createWorkspace('Nova');
    const { invitation } = await createInvite(workspace.admin, {
      email: 'expired@example.test',
      role: 'member',
      teamIds: [workspace.teamId],
    });
    await db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.invitation.id, invitation.id));
    await expect(assertInvited('expired@example.test')).rejects.toThrow(INVITATION_REQUIRED);
  });

  it('HTTP: once an account exists, a stranger is refused by the request check and by the sender backstop', async () => {
    await createWorkspace('Nova');
    const refused = await withNativeFetchGlobals(() =>
      authPost(
        authRequest('email-otp/send-verification-otp', {
          email: 'stranger@example.test',
          type: 'sign-in',
        }),
      ),
    );
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain('INVITATION_REQUIRED');

    const labels = Array.from({ length: 4 }, () => 'b'.repeat(60));
    const tooLong = `${'a'.repeat(64)}@${labels.join('.')}.test`;
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await withEmailConfigured(() =>
        withNativeFetchGlobals(() =>
          authPost(
            authRequest('email-otp/send-verification-otp', { email: tooLong, type: 'sign-in' }),
          ),
        ),
      );
      expect(response.status).toBe(200);
      const refusedBySender = consoleError.mock.calls.some((args) =>
        args.some((arg) => arg instanceof Error && INVITATION_REQUIRED.test(arg.message)),
      );
      expect(refusedBySender).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
    expect(await deliveries()).toBe(0);
  });

  it('HTTP: password sign-up stays refused', async () => {
    const response = await withNativeFetchGlobals(() =>
      authPost(authRequest('sign-up/email', { email: OWNER, password: PASSWORD, name: 'Owner' })),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(SIGN_UP_DISABLED);
    expect(await userCount()).toBe(0);
  });

  it('HTTP: the whole create flow, then the same address again keeps the first password', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await withNativeFetchGlobals(async () => {
        const first = await signUpByCode(OWNER, PASSWORD);
        expect(first.signIn.status).toBe(200);
        expect(first.password.status).toBe(200);
        expect(await userCount()).toBe(1);
        const signedIn = await authPost(
          authRequest('sign-in/email', { email: OWNER, password: PASSWORD }),
        );
        expect(signedIn.status).toBe(200);

        const again = await signUpByCode(OWNER, 'a-different-password-1');
        expect(again.signIn.status).toBe(200);
        expect(again.password.status).toBe(500);
        expect(await userCount()).toBe(1);
        const accounts = await auth.api.listUserAccounts({
          headers: new Headers({ cookie: requestCookie }),
        });
        expect(accounts.filter((account) => account.providerId === 'credential')).toHaveLength(1);
        const kept = await authPost(
          authRequest('sign-in/email', { email: OWNER, password: PASSWORD }),
        );
        expect(kept.status).toBe(200);
        const replaced = await authPost(
          authRequest('sign-in/email', { email: OWNER, password: 'a-different-password-1' }),
        );
        expect(replaced.status).toBe(401);
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('HTTP: a Verify on an empty database is refused once another account exists, and the code is spent', async () => {
    const otp = await auth.api.createVerificationOTP({
      body: { email: 'late@example.test', type: 'sign-in' },
    });
    await createPasswordUser(OWNER, PASSWORD);
    const response = await withNativeFetchGlobals(() =>
      authPost(authRequest('sign-in/email-otp', { email: 'late@example.test', otp })),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('INVITATION_REQUIRED');
    expect(await userCount()).toBe(1);
    expect(await verificationRows()).toBe(0);
  });

  it('only the oldest account may create a workspace while invitation-only is on', async () => {
    const owner = await createUser('Owner');
    const second = await createUser('Second');
    expect(await canCreateWorkspace(owner.id)).toBe(true);
    expect(await canCreateWorkspace(second.id)).toBe(false);
    process.env['ORBIT_INVITE_ONLY'] = '0';
    try {
      expect(await canCreateWorkspace(second.id)).toBe(true);
    } finally {
      process.env['ORBIT_INVITE_ONLY'] = 'true';
    }
  });
});
