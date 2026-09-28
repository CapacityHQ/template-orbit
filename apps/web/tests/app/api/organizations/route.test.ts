import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createUser, resetDatabase } from '@orbit/core/test-support';
import { mockSession, restoreModulesAfterThisFile } from '../../../../tests-support.ts';

let userId = '';

mockSession(() => ({
  user: { id: userId, name: 'Someone', email: 'someone@orbit.test' },
  session: { activeOrganizationId: null },
}));

await restoreModulesAfterThisFile(['next/headers']);
mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const { POST } = await import('@/app/api/organizations/route.ts');

const previousFlag = process.env['ORBIT_INVITE_ONLY'];
afterAll(() => {
  if (previousFlag === undefined) delete process.env['ORBIT_INVITE_ONLY'];
  else process.env['ORBIT_INVITE_ONLY'] = previousFlag;
});

function create(slug: string): Promise<Response> {
  return POST(
    new Request('http://localhost:3000/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nova', slug }),
    }),
  );
}

describe('POST /api/organizations', () => {
  beforeEach(async () => {
    process.env['ORBIT_INVITE_ONLY'] = 'true';
    await resetDatabase();
  });

  it('lets the oldest account create a workspace and refuses every later one', async () => {
    const owner = await createUser('Owner');
    const second = await createUser('Second');
    userId = owner.id;
    expect((await create('nova')).status).toBe(200);

    userId = second.id;
    const refused = await create('comet');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: {
        code: 'forbidden',
        message:
          'Only the person who set up this Orbit can create workspaces. Ask them to invite you.',
      },
    });
  });

  it('lets anyone create a workspace when invitation-only is off', async () => {
    process.env['ORBIT_INVITE_ONLY'] = '0';
    await createUser('Owner');
    userId = (await createUser('Second')).id;
    expect((await create('comet')).status).toBe(200);
  });
});
