'use client';

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  signInCodeRequestSchema,
  signInCodeVerifySchema,
} from '@orbit/shared/validators';
import { Loader2, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { LoginMode } from '@/app/(auth)/login/continue-url.ts';
import { OrbitMark } from '@/components/brand/orbit-logo.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';
import { LoginForm, type LoginFormProps, OtpFields } from './login-form.tsx';

export type CreateMode = Exclude<LoginMode, 'sign-in'>;

export type CreateAccountFormProps = LoginFormProps & {
  readonly mode: CreateMode;
  readonly lockEmail: boolean;
};

const DEFAULT_CALLBACK_URL = '/my-issues';

const HEADINGS: Record<CreateMode, { title: string; subtitle: string }> = {
  'first-account': {
    title: 'Create your Orbit account',
    subtitle: 'The first account becomes the admin.',
  },
  invited: {
    title: 'Create your account',
    subtitle: 'Then join the workspace you were invited to.',
  },
};

const OUTCOME_MESSAGES = {
  kept: 'You already had an Orbit account, so your password is unchanged. Use Forgot password? on the sign-in page to change it.',
  unsaved:
    "Your account is ready, but the password wasn't saved. Set one in Settings › Account › Password.",
} as const;

const EMAIL_REQUIRED_MESSAGE =
  "Accounts can't be created until email is set up: fill RESEND_API_KEY and EMAIL_FROM.";

type PasswordOutcome = 'saved' | keyof typeof OUTCOME_MESSAGES;

async function savePassword(password: string): Promise<PasswordOutcome> {
  try {
    const accounts = await authClient.listAccounts();
    if (accounts.data?.some((account) => account.providerId === 'credential')) return 'kept';
    await apiRequest('/api/account/password', { method: 'POST', body: { newPassword: password } });
    return 'saved';
  } catch {
    return 'unsaved';
  }
}

interface CreateAccountState {
  readonly email: string;
  readonly password: string;
  readonly otp: string;
  readonly sent: boolean;
  readonly pending: boolean;
  readonly outcome: keyof typeof OUTCOME_MESSAGES | null;
  readonly setEmail: (value: string) => void;
  readonly setPassword: (value: string) => void;
  readonly setOtp: (value: string) => void;
  readonly requestCode: () => void;
  readonly verifyCode: () => void;
  readonly changeEmail: () => void;
}

function useCreateAccount(login: LoginFormProps): CreateAccountState {
  const { callbackUrl = DEFAULT_CALLBACK_URL, passwordEnabled = false, initialEmail = '' } = login;
  const { toast } = useToast();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<keyof typeof OUTCOME_MESSAGES | null>(null);

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    try {
      await work();
    } catch (error: unknown) {
      toast({ title: 'Sign up failed', description: messageOf(error), tone: 'danger' });
    } finally {
      setPending(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      const input = signInCodeRequestSchema.parse({ email });
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: input.email,
        type: 'sign-in',
      });
      if (result.error) throw new Error(result.error.message ?? 'Could not send the code.');
      setSent(true);
    });

  const verifyCode = () =>
    run(async () => {
      const result = await authClient.signIn.emailOtp(signInCodeVerifySchema.parse({ email, otp }));
      if (result.error) throw new Error(result.error.message ?? 'That code is invalid or expired.');
      const session = await authClient.getSession({ query: { disableCookieCache: true } });
      if (session.error || !session.data?.user.emailVerified) {
        throw new Error('Could not confirm your verified session. Sign in again.');
      }
      const saved = passwordEnabled ? await savePassword(password) : 'saved';
      if (saved === 'saved') window.location.assign(callbackUrl);
      else setOutcome(saved);
    });

  const changeEmail = () => {
    setOtp('');
    setSent(false);
  };

  return {
    email,
    password,
    otp,
    sent,
    pending,
    outcome,
    setEmail,
    setPassword,
    setOtp,
    requestCode,
    verifyCode,
    changeEmail,
  };
}

function CreateAccountFields({
  state,
  passwordEnabled,
  lockEmail,
}: {
  readonly state: CreateAccountState;
  readonly passwordEnabled: boolean;
  readonly lockEmail: boolean;
}) {
  const { email, password, otp, sent, pending } = state;
  const passwordShort = passwordEnabled && !sent && password.length < MIN_PASSWORD_LENGTH;
  const disabled = pending || email.length === 0 || passwordShort || (sent && otp.length !== 6);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sent) state.verifyCode();
    else state.requestCode();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="create-email" className="sr-only">
        Email address
      </label>
      <Input
        id="create-email"
        type="email"
        name="email"
        autoComplete="email"
        required
        placeholder="you@company.com"
        value={email}
        readOnly={lockEmail}
        disabled={sent}
        onChange={(event) => state.setEmail(event.target.value)}
      />
      {passwordEnabled && !sent ? (
        <>
          <label htmlFor="create-password" className="sr-only">
            Password
          </label>
          <Input
            id="create-password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            placeholder={`Password (${MIN_PASSWORD_LENGTH} characters or more)`}
            value={password}
            onChange={(event) => state.setPassword(event.target.value)}
          />
        </>
      ) : null}
      <OtpFields
        sent={sent}
        value={otp}
        pending={pending}
        onChange={state.setOtp}
        onResend={() => {
          state.setOtp('');
          state.requestCode();
        }}
        onChangeEmail={lockEmail ? undefined : state.changeEmail}
      />
      <Button type="submit" variant="primary" size="md" block disabled={disabled}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus className="size-4" aria-hidden="true" />
        )}
        {sent ? 'Verify' : 'Create account'}
      </Button>
    </form>
  );
}

function CreateAccount({
  mode,
  lockEmail,
  login,
  onSignIn,
}: {
  readonly mode: CreateMode;
  readonly lockEmail: boolean;
  readonly login: LoginFormProps;
  readonly onSignIn: () => void;
}) {
  const state = useCreateAccount(login);
  const {
    callbackUrl = DEFAULT_CALLBACK_URL,
    passwordEnabled = false,
    emailEnabled = true,
  } = login;
  const heading = HEADINGS[mode];

  return (
    <div className="flex w-full max-w-[22rem] flex-col gap-5">
      <div className="flex flex-col gap-1.5 text-center">
        <OrbitMark size={36} className="mx-auto" />
        <h1 className="font-medium text-text text-xl">{heading.title}</h1>
        <p className="text-muted text-xs">{heading.subtitle}</p>
      </div>
      {state.outcome === null ? null : (
        <div className="flex flex-col gap-3">
          <p className="text-muted text-xs">{OUTCOME_MESSAGES[state.outcome]}</p>
          <Button
            variant="primary"
            size="md"
            block
            onClick={() => window.location.assign(callbackUrl)}
          >
            Continue
          </Button>
        </div>
      )}
      {state.outcome === null && !emailEnabled ? (
        <p className="text-center text-muted text-xs">{EMAIL_REQUIRED_MESSAGE}</p>
      ) : null}
      {state.outcome === null && emailEnabled ? (
        <CreateAccountFields
          state={state}
          passwordEnabled={passwordEnabled}
          lockEmail={lockEmail}
        />
      ) : null}
      <button
        type="button"
        className="text-center text-muted text-xs underline-offset-2 hover:underline"
        onClick={onSignIn}
      >
        I already have an account
      </button>
    </div>
  );
}

export function CreateAccountForm({ mode, lockEmail, ...login }: CreateAccountFormProps) {
  const [wantsSignIn, setWantsSignIn] = useState(false);
  if (wantsSignIn) return <LoginForm {...login} onCreateAccount={() => setWantsSignIn(false)} />;
  return (
    <CreateAccount
      mode={mode}
      lockEmail={lockEmail}
      login={login}
      onSignIn={() => setWantsSignIn(true)}
    />
  );
}
