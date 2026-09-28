import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createUser, resetDatabase } from '@orbit/core/test-support';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';
import { mockSession, restoreModulesAfterThisFile } from '../../../../tests-support.ts';

const INVITE_ONLY_LINE = 'Orbit is invitation-only. Ask a workspace admin to invite you.';
const ENV_NAMES = ['ORBIT_INVITE_ONLY', 'RESEND_API_KEY', 'EMAIL_FROM'] as const;
const previousEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
const holder: { value: { user: { id: string } } | null } = { value: null };

mockSession(() => holder.value);

await restoreModulesAfterThisFile(['next/navigation', '@/components/ui/toast.tsx']);
mock.module('next/navigation', () => ({
  ...navigation,
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

const { default: LoginPage } = await import('@/app/(auth)/login/page.tsx');

afterAll(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(async () => {
  process.env['ORBIT_INVITE_ONLY'] = 'true';
  process.env['RESEND_API_KEY'] = 're_test_not_a_real_key';
  process.env['EMAIL_FROM'] = 'Orbit <auth@example.com>';
  holder.value = null;
  await resetDatabase();
});

async function renderPage(params: Record<string, string>): Promise<void> {
  render(await LoginPage({ searchParams: Promise.resolve(params) }));
}

function heading(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

describe('LoginPage', () => {
  it('opens on the first-account form while the database has no account', async () => {
    await renderPage({});
    expect(heading()).toHaveTextContent('Create your Orbit account');
    expect(screen.getByText('The first account becomes the admin.')).toBeVisible();
    expect(screen.getByLabelText('Email address')).not.toHaveAttribute('readonly');
  });

  it('opens on the sign-in form once an account exists', async () => {
    await createUser('Owner');
    await renderPage({});
    expect(heading()).toHaveTextContent('Sign in to Orbit');
    expect(screen.getByText(INVITE_ONLY_LINE)).toBeVisible();
  });

  it('opens the invited create form with the address lowercased and read-only', async () => {
    await createUser('Owner');
    await renderPage({ create: '1', email: 'Invited@Example.test' });
    expect(heading()).toHaveTextContent('Create your account');
    const email = screen.getByLabelText('Email address');
    expect(email).toHaveValue('invited@example.test');
    expect(email).toHaveAttribute('readonly');
  });

  it('keeps a signed-in visitor on the create form when the invite link asks to switch account', async () => {
    const owner = await createUser('Owner');
    holder.value = { user: { id: owner.id } };
    const invitation = { next: '/invite/abc', email: 'invited@example.test', create: '1' };
    await expect(renderPage(invitation)).rejects.toThrow('redirect:/invite/abc');

    await renderPage({ reauth: '1', ...invitation });
    expect(heading()).toHaveTextContent('Create your account');
    expect(screen.getByLabelText('Email address')).toHaveValue('invited@example.test');
  });

  it('opens on the sign-in form when invitation-only is off, even on an empty database', async () => {
    process.env['ORBIT_INVITE_ONLY'] = '0';
    await renderPage({ create: '1' });
    expect(heading()).toHaveTextContent('Sign in to Orbit');
    expect(screen.queryByText(INVITE_ONLY_LINE)).toBe(null);
  });
});
