import { describe, expect, it } from 'bun:test';
import {
  invitedEmail,
  loginMode,
  mcpContinueUrl,
  safeCallback,
} from '../../../../src/app/(auth)/login/continue-url.ts';

describe('mcpContinueUrl', () => {
  it('rebuilds the authorize URL from a paused MCP request', () => {
    const url = mcpContinueUrl({
      response_type: 'code',
      client_id: 'client_123',
      redirect_uri: 'http://127.0.0.1:9000/callback',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      scope: 'openid orbit.read',
      state: 'xyz',
      prompt: 'consent',
    });
    expect(url).toBeDefined();
    const parsed = new URL(url ?? '', 'http://localhost:3000');
    expect(parsed.pathname).toBe('/api/auth/mcp/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client_123');
    expect(parsed.searchParams.get('code_challenge')).toBe('abc');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('ignores a request that is not an MCP authorize', () => {
    expect(mcpContinueUrl({ next: '/my-issues' })).toBeUndefined();
    expect(mcpContinueUrl({ client_id: 'x' })).toBeUndefined();
  });
});

describe('safeCallback', () => {
  it('accepts a same-origin path and rejects an absolute URL', () => {
    expect(safeCallback('/settings')).toBe('/settings');
    expect(safeCallback('https://evil.example')).toBeUndefined();
    expect(safeCallback('//evil.example')).toBeUndefined();
  });
});

describe('loginMode', () => {
  it('is sign-in whenever invitation-only is off, whatever the URL says', () => {
    expect(loginMode({ create: '1' }, { inviteOnly: false, hasAccounts: false })).toBe('sign-in');
  });

  it('is first-account on an empty database, invited with create=1, sign-in otherwise', () => {
    expect(loginMode({}, { inviteOnly: true, hasAccounts: false })).toBe('first-account');
    expect(loginMode({ create: '1' }, { inviteOnly: true, hasAccounts: false })).toBe(
      'first-account',
    );
    expect(loginMode({ create: '1' }, { inviteOnly: true, hasAccounts: true })).toBe('invited');
    expect(loginMode({}, { inviteOnly: true, hasAccounts: true })).toBe('sign-in');
    expect(loginMode({ create: ['1'] }, { inviteOnly: true, hasAccounts: true })).toBe('sign-in');
  });
});

describe('invitedEmail', () => {
  it('accepts one address of at most 254 characters', () => {
    expect(invitedEmail('a@b.test')).toBe('a@b.test');
    expect(invitedEmail(['a@b.test'])).toBeUndefined();
    expect(invitedEmail('not-an-address')).toBeUndefined();
    expect(invitedEmail(`${'a'.repeat(250)}@b.test`)).toBeUndefined();
  });

  it('rejects what the shared email schema rejects and lowercases the address', () => {
    expect(invitedEmail('@')).toBeUndefined();
    expect(invitedEmail('a@')).toBeUndefined();
    expect(invitedEmail('a b@c.test')).toBeUndefined();
    expect(invitedEmail('A@B.test')).toBe('a@b.test');
  });
});
