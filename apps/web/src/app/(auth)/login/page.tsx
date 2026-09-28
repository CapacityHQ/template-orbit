import { emailConfigured } from '@orbit/shared/utils';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthErrorNotice } from '@/components/auth/auth-error-notice.tsx';
import { CreateAccountForm } from '@/components/auth/create-account-form.tsx';
import { DevSignIn } from '@/components/auth/dev-sign-in.tsx';
import { LoginForm, type LoginFormProps } from '@/components/auth/login-form.tsx';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';
import { listDevUsers } from '@/lib/api/dev-users.ts';
import { hasAnyAccount } from '@/lib/auth/first-account.ts';
import { authErrorCode } from '@/lib/auth/oauth-error.ts';
import { enabledSocialProviders, passwordAuthEnabled } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';
import { inviteOnly, signUpIsOpen } from '@/lib/env.ts';
import { invitedEmail, loginMode, mcpContinueUrl, safeCallback } from './continue-url.ts';

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
  const email = invitedEmail(params['email']);
  const hasAccounts = inviteOnly() ? await hasAnyAccount() : true;
  const mode = loginMode(params, { inviteOnly: inviteOnly(), hasAccounts });
  const form: LoginFormProps = {
    providers: enabledSocialProviders,
    passwordEnabled: passwordAuthEnabled,
    emailEnabled: emailConfigured(process.env),
    openSignUp: signUpIsOpen(),
    inviteOnly: inviteOnly(),
    ...(callbackUrl === undefined ? {} : { callbackUrl }),
    ...(email === undefined ? {} : { initialEmail: email }),
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        {mode === 'sign-in' ? (
          <LoginForm {...form} />
        ) : (
          <CreateAccountForm
            mode={mode}
            lockEmail={mode === 'invited' && email !== undefined}
            {...form}
          />
        )}
        {devUsers.length > 0 ? (
          <DevSignIn users={devUsers} callbackUrl={callbackUrl ?? '/my-issues'} />
        ) : null}
      </div>
      {errorCode === undefined ? null : <AuthErrorNotice code={errorCode} />}
    </main>
  );
}
