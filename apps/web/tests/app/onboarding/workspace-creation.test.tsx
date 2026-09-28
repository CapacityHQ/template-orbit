import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { advanceOnboarding } from '@orbit/core';
import { createUser, resetDatabase } from '@orbit/core/test-support';
import { mockSession } from '../../../tests-support.ts';

let userId = '';

mockSession(() => ({ user: { id: userId, emailVerified: true } }));

const { default: OnboardingPage } = await import(
  '../../../src/app/(onboarding)/onboarding/page.tsx'
);

const previousFlag = process.env['ORBIT_INVITE_ONLY'];
afterAll(() => {
  if (previousFlag === undefined) delete process.env['ORBIT_INVITE_ONLY'];
  else process.env['ORBIT_INVITE_ONLY'] = previousFlag;
});

beforeEach(async () => {
  process.env['ORBIT_INVITE_ONLY'] = 'true';
  await resetDatabase();
});

async function workspaceStepOf(id: string) {
  await advanceOnboarding(id, { step: 'profile' });
  userId = id;
  const page = await OnboardingPage({ searchParams: Promise.resolve({}) });
  return page.props;
}

describe('OnboardingPage workspace creation', () => {
  it('gives a second account the workspace step without the create option, and the oldest keeps it', async () => {
    const owner = await createUser('Owner');
    const second = await createUser('Second');

    const secondStep = await workspaceStepOf(second.id);
    expect(secondStep.initialStep).toBe('workspace');
    expect(secondStep.canCreateWorkspace).toBe(false);

    const ownerStep = await workspaceStepOf(owner.id);
    expect(ownerStep.initialStep).toBe('workspace');
    expect(ownerStep.canCreateWorkspace).toBe(true);
  });
});
