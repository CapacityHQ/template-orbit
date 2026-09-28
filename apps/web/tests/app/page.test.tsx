import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as navigation from 'next/navigation';
import { mockSession, restoreModulesAfterThisFile } from '../../tests-support.ts';

const sessionHolder: { value: { user: { id: string } } | null } = { value: null };

mockSession(() => sessionHolder.value);

await restoreModulesAfterThisFile(['next/navigation']);

mock.module('next/navigation', () => ({
  ...navigation,
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { default: HomePage } = await import('../../src/app/page.tsx');
const { default: HomeLandingPage } = await import('../../src/app/home/page.tsx');

describe('/ and /home', () => {
  beforeEach(() => {
    sessionHolder.value = null;
  });

  it('send a signed-out visitor to sign in', async () => {
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/login',
    );
    await expect(HomeLandingPage()).rejects.toThrow('redirect:/login');
  });

  it('keep an auth error code on the way to sign in', async () => {
    await expect(
      HomePage({ searchParams: Promise.resolve({ error: 'access_denied' }) }),
    ).rejects.toThrow('redirect:/login?error=access_denied');
  });

  it('send a signed-in visitor to their issues', async () => {
    sessionHolder.value = { user: { id: 'user-1' } };
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/my-issues',
    );
    await expect(HomeLandingPage()).rejects.toThrow('redirect:/my-issues');
  });
});
