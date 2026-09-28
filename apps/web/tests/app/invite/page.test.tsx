import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createInvite } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { render, screen } from '@testing-library/react';
import { mockSession } from '../../../tests-support.ts';

const INVITED = 'invited@example.test';
const holder: { value: { user: { id: string; email: string; emailVerified: boolean } } | null } = {
  value: null,
};

mockSession(() => holder.value);

const { default: InvitePage } = await import('@/app/invite/[token]/page.tsx');

const previousFlag = process.env['ORBIT_INVITE_ONLY'];
afterAll(() => {
  if (previousFlag === undefined) delete process.env['ORBIT_INVITE_ONLY'];
  else process.env['ORBIT_INVITE_ONLY'] = previousFlag;
});

let workspace: Workspace;
let token = '';

beforeEach(async () => {
  process.env['ORBIT_INVITE_ONLY'] = 'true';
  holder.value = null;
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const created = await createInvite(workspace.admin, {
    email: INVITED,
    role: 'member',
    teamIds: [workspace.teamId],
  });
  token = created.invitation.id;
});

async function renderPage() {
  render(await InvitePage({ params: Promise.resolve({ token }) }));
}

async function invitedAccountExists(): Promise<void> {
  await db.insert(schema.user).values({
    id: 'user-invited',
    name: 'Invited',
    email: INVITED,
    emailVerified: true,
    handle: 'invited',
  });
}

const encodedNext = () => `next=%2Finvite%2F${token}`;

describe('InvitePage', () => {
  it('offers to create the account when none exists for the invited address', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Create your account to join Nova',
    );
    expect(screen.getByRole('link', { name: 'Create your account' })).toHaveAttribute(
      'href',
      `/login?${encodedNext()}&email=invited%40example.test&create=1`,
    );
  });

  it('keeps "Sign in to continue" when the invited address already has an account', async () => {
    await invitedAccountExists();
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Join Nova');
    expect(screen.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
      'href',
      `/login?${encodedNext()}&email=invited%40example.test`,
    );
  });

  it('sends the wrong account to create the invited one, or to sign in when it exists', async () => {
    holder.value = { user: { id: 'user-other', email: 'other@example.test', emailVerified: true } };
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Wrong account');
    expect(screen.getByRole('link', { name: 'Switch account' })).toHaveAttribute(
      'href',
      `/login?reauth=1&${encodedNext()}&email=invited%40example.test&create=1`,
    );
    expect(
      screen.getByText(/Sign out and create an account with the invited address\./),
    ).toBeVisible();
    expect(screen.queryByText(/sign back in/)).toBe(null);

    await invitedAccountExists();
    await renderPage();
    expect(screen.getAllByRole('link', { name: 'Switch account' })[1]).toHaveAttribute(
      'href',
      `/login?reauth=1&${encodedNext()}&email=invited%40example.test`,
    );
    expect(screen.getByText(/Sign out and sign back in with the invited address\./)).toBeVisible();
  });

  it('never offers create=1 when invitation-only is off', async () => {
    process.env['ORBIT_INVITE_ONLY'] = '0';
    await renderPage();
    expect(screen.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
      'href',
      `/login?${encodedNext()}&email=invited%40example.test`,
    );
  });
});
