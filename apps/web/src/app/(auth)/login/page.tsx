import { emailConfigured } from '@orbit/shared/utils';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthErrorNotice } from '@/components/auth/auth-error-notice.tsx';
import { DevAccountNotice } from '@/components/auth/dev-account-notice.tsx';
import { DevSignIn } from '@/components/auth/dev-sign-in.tsx';
import { LoginForm } from '@/components/auth/login-form.tsx';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';
import { listDevUsers } from '@/lib/api/dev-users.ts';
import { devAccountPrefill } from '@/lib/auth/dev-account.ts';
import { authErrorCode } from '@/lib/auth/oauth-error.ts';
import { enabledSocialProviders, passwordAuthEnabled } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';
import { inviteOnly, signUpIsOpen } from '@/lib/env.ts';
import { mcpContinueUrl, safeCallback } from './continue-url.ts';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = mcpContinueUrl(params) ?? safeCallback(params['next']);
  const errorCode = authErrorCode(params['error']);
  const session = await getSession();
  if (session !== null && params['reauth'] !== '1') redirect(callbackUrl ?? '/my-issues');

  const devUsers = devLoginEnabled() ? await listDevUsers() : [];
  const devAccount = await devAccountPrefill();
  const invitedEmail =
    typeof params['email'] === 'string' &&
    params['email'].includes('@') &&
    params['email'].length <= 254
      ? params['email']
      : undefined;
  const initialEmail = invitedEmail ?? devAccount?.email;
  const initialPassword =
    devAccount !== null && initialEmail === devAccount.email ? devAccount.password : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <LoginForm
          providers={enabledSocialProviders}
          passwordEnabled={passwordAuthEnabled}
          emailEnabled={emailConfigured(process.env)}
          openSignUp={signUpIsOpen()}
          inviteOnly={inviteOnly()}
          {...(callbackUrl === undefined ? {} : { callbackUrl })}
          {...(initialEmail === undefined ? {} : { initialEmail })}
          {...(initialPassword === undefined ? {} : { initialPassword })}
        />
        {devUsers.length > 0 ? (
          <DevSignIn users={devUsers} callbackUrl={callbackUrl ?? '/my-issues'} />
        ) : null}
        {devAccount !== null && invitedEmail === undefined ? (
          <DevAccountNotice email={devAccount.email} password={devAccount.password} />
        ) : null}
      </div>
      {errorCode === undefined ? null : <AuthErrorNotice code={errorCode} />}
    </main>
  );
}
