import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInvite } from '@orbit/core';
import { createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { count, db, eq, schema } from '@orbit/db';
import { POST as authPost } from '@/app/api/auth/[...all]/route.ts';
import { hashPassword } from '@/lib/auth/password.ts';
import { assertInvited, assertSignInCodeAllowed, auth } from '@/lib/auth/server.ts';
import { inviteOnly, signUpIsOpen } from '@/lib/env.ts';
import { nativeFetchGlobals } from '../../tests-preload.ts';

const APP_ORIGIN = 'http://localhost:3000';
const INVITATION_REQUIRED = /invitation-only/;
const ROOT = resolve(import.meta.dir, '../../../..');
const SIGN_UP_DISABLED = /EMAIL_PASSWORD_SIGN_UP_DISABLED/;

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

function authRequest(path: string, body: unknown): Request {
  return new Request(`${APP_ORIGIN}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
    body: JSON.stringify(body),
  });
}

async function withEmailConfigured<T>(operation: () => Promise<T>): Promise<T> {
  const original = {
    RESEND_API_KEY: process.env['RESEND_API_KEY'],
    EMAIL_FROM: process.env['EMAIL_FROM'],
  };
  process.env['RESEND_API_KEY'] = 're_test_not_a_real_key';
  process.env['EMAIL_FROM'] = 'Orbit <auth@example.com>';
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
    name: 'Admin',
    email,
    emailVerified: true,
    handle: `admin-${userId.slice(0, 8)}`,
  });
  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(password),
  });
}

describe('invitation-only sign-up', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('runs with the template defaults (the runner copies .env.example to .env)', () => {
    expect(process.env['ORBIT_INVITE_ONLY']).toBe('true');
    expect(process.env['ORBIT_PASSWORD_AUTH']).toBe('true');
    expect(process.env['ORBIT_DEV_LOGIN']).toBe('0');
    expect(inviteOnly()).toBe(true);
    expect(signUpIsOpen()).toBe(false);

    const envExample = readFileSync(resolve(ROOT, '.env.example'), 'utf8');
    for (const name of [
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'ORBIT_ADMIN_EMAIL',
      'ORBIT_ADMIN_PASSWORD',
    ]) {
      expect(isDeclaredAndRequired(envExample, name)).toBe(true);
    }
  });

  it('refuses to create an account for an address without a pending invitation', async () => {
    await expect(assertInvited('stranger@example.test')).rejects.toThrow(INVITATION_REQUIRED);
  });

  it('lets an invited address through, case-insensitively', async () => {
    const workspace = await createWorkspace('Nova');
    await createInvite(workspace.admin, {
      email: 'invited@example.test',
      role: 'member',
      teamIds: [workspace.teamId],
    });
    await expect(assertInvited('Invited@Example.test')).resolves.toBeUndefined();
  });

  it('the email-code check passes for an existing account and refuses a stranger', async () => {
    const workspace = await createWorkspace('Nova');
    await expect(assertSignInCodeAllowed(workspace.adminUser.email)).resolves.toBeUndefined();
    await expect(assertSignInCodeAllowed('stranger@example.test')).rejects.toThrow(
      INVITATION_REQUIRED,
    );
  });

  it('HTTP: an email code for an unknown address is refused before anything is stored', async () => {
    const response = await withNativeFetchGlobals(() =>
      authPost(
        authRequest('email-otp/send-verification-otp', {
          email: 'stranger@example.test',
          type: 'sign-in',
        }),
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('INVITATION_REQUIRED');
    const [row] = await db.select({ rows: count() }).from(schema.verification);
    expect(row?.rows ?? 0).toBe(0);
    const [delivery] = await db.select({ rows: count() }).from(schema.emailDelivery);
    expect(delivery?.rows ?? 0).toBe(0);
  });

  it('HTTP: an email code for an address the request check skips is refused by the sender', async () => {
    const labels = Array.from({ length: 4 }, () => 'b'.repeat(60));
    const email = `${'a'.repeat(64)}@${labels.join('.')}.test`;
    expect(email.length).toBeGreaterThan(254);
    const consoleError = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await withEmailConfigured(() =>
        withNativeFetchGlobals(() =>
          authPost(authRequest('email-otp/send-verification-otp', { email, type: 'sign-in' })),
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
    const [delivery] = await db.select({ rows: count() }).from(schema.emailDelivery);
    expect(delivery?.rows ?? 0).toBe(0);
    expect(await userCount()).toBe(0);
  });

  it('HTTP: password sign-up is refused and creates no user', async () => {
    const response = await withNativeFetchGlobals(() =>
      authPost(
        authRequest('sign-up/email', {
          email: 'new@example.test',
          password: 'another-long-password-1',
          name: 'New',
        }),
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(SIGN_UP_DISABLED);
    expect(await userCount()).toBe(0);
  });

  it('HTTP: an existing password account still signs in', async () => {
    await createPasswordUser('admin@example.test', 'twelve-characters-long');
    const response = await withNativeFetchGlobals(() =>
      authPost(
        authRequest('sign-in/email', {
          email: 'admin@example.test',
          password: 'twelve-characters-long',
        }),
      ),
    );
    expect(response.status).toBe(200);
  });

  it('the user-create database hook rejects a stranger and admits an invited address', async () => {
    const before = auth.options.databaseHooks?.user?.create?.before;
    if (before === undefined) throw new Error('the user create hook is missing');
    const attempt = (email: string) =>
      before({
        id: 'user_1',
        name: 'Invitee',
        email,
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    await expect(attempt('stranger@example.test')).rejects.toThrow(INVITATION_REQUIRED);

    const workspace = await createWorkspace('Nova');
    await createInvite(workspace.admin, {
      email: 'invited@example.test',
      role: 'member',
      teamIds: [workspace.teamId],
    });
    await expect(attempt('invited@example.test')).resolves.toBeDefined();
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

    const response = await withNativeFetchGlobals(() =>
      authPost(
        authRequest('email-otp/send-verification-otp', {
          email: 'expired@example.test',
          type: 'sign-in',
        }),
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('INVITATION_REQUIRED');
    const [row] = await db.select({ rows: count() }).from(schema.verification);
    expect(row?.rows ?? 0).toBe(0);
    const [delivery] = await db.select({ rows: count() }).from(schema.emailDelivery);
    expect(delivery?.rows ?? 0).toBe(0);
  });
});
