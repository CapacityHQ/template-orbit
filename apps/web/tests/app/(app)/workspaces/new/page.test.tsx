import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createUser, resetDatabase } from '@orbit/core/test-support';
import { render, screen } from '@testing-library/react';
import { mockSession, restoreModulesAfterThisFile } from '../../../../../tests-support.ts';

let userId = '';

mockSession(() => ({ user: { id: userId, name: 'Someone', email: 'someone@orbit.test' } }));

await restoreModulesAfterThisFile([
  'next/navigation',
  '@/components/ui/toast.tsx',
  '@/lib/auth/client.ts',
]);
mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), refresh: mock(), back: mock() }),
}));
mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));
mock.module('@/lib/auth/client.ts', () => ({
  authClient: { organization: { setActive: mock() } },
}));

const { default: NewWorkspacePage } = await import('@/app/(app)/workspaces/new/page.tsx');

const previousFlag = process.env['ORBIT_INVITE_ONLY'];
afterAll(() => {
  if (previousFlag === undefined) delete process.env['ORBIT_INVITE_ONLY'];
  else process.env['ORBIT_INVITE_ONLY'] = previousFlag;
});

describe('NewWorkspacePage', () => {
  beforeEach(async () => {
    process.env['ORBIT_INVITE_ONLY'] = 'true';
    await resetDatabase();
  });

  it('shows the form to the oldest account and the invitation sentence to a later one', async () => {
    const owner = await createUser('Owner');
    const second = await createUser('Second');

    userId = owner.id;
    render(await NewWorkspacePage());
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument();

    userId = second.id;
    render(await NewWorkspacePage());
    expect(
      screen.getByText("You're not in a workspace yet. Ask an admin to invite you."),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Create workspace' })).toHaveLength(1);
  });

  it('shows the form to anyone when invitation-only is off', async () => {
    process.env['ORBIT_INVITE_ONLY'] = '0';
    await createUser('Owner');
    userId = (await createUser('Second')).id;
    render(await NewWorkspacePage());
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument();
  });
});
