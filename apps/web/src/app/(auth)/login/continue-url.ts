import { emailSchema } from '@orbit/shared/validators';
import { safeNextPath } from '@/lib/next-path.ts';

export function safeCallback(value: string | string[] | undefined): string | undefined {
  return safeNextPath(value) ?? undefined;
}

const MCP_AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'prompt',
  'nonce',
] as const;

export function mcpContinueUrl(
  params: Record<string, string | string[] | undefined>,
): string | undefined {
  if (typeof params['client_id'] !== 'string' || typeof params['response_type'] !== 'string') {
    return undefined;
  }
  const search = new URLSearchParams();
  for (const key of MCP_AUTHORIZE_PARAMS) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) search.set(key, value);
  }
  return `/api/auth/mcp/authorize?${search.toString()}`;
}

export type LoginMode = 'first-account' | 'invited' | 'sign-in';

export function loginMode(
  params: Record<string, string | string[] | undefined>,
  state: { inviteOnly: boolean; hasAccounts: boolean },
): LoginMode {
  if (!state.inviteOnly) return 'sign-in';
  if (!state.hasAccounts) return 'first-account';
  return params['create'] === '1' ? 'invited' : 'sign-in';
}

export function invitedEmail(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
