import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

const order: string[] = [];
const sendVerificationOtp = mock();
const signInEmailOtp = mock();
const getSession = mock();
const listAccounts = mock();
const toast = mock();
const assign = mock();
const originalLocation = window.location;
const realFetch = globalThis.fetch;

await restoreModulesAfterThisFile(['@/components/ui/toast.tsx', '@/lib/auth/client.ts']);

Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...window.location, origin: 'http://localhost:3000', assign },
});

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    getSession: (...args: unknown[]) => getSession(...args),
    listAccounts: (...args: unknown[]) => {
      order.push('list');
      return listAccounts(...args);
    },
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => {
        order.push('send');
        return sendVerificationOtp(...args);
      },
    },
    signIn: {
      emailOtp: (...args: unknown[]) => {
        order.push('verify');
        return signInEmailOtp(...args);
      },
      passkey: () => Promise.resolve({ data: null, error: null }),
      social: () => Promise.resolve({ data: null, error: null }),
      email: () => Promise.resolve({ data: null, error: null }),
    },
    requestPasswordReset: () => Promise.resolve({ data: null, error: null }),
  },
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const { CreateAccountForm } = await import('../../../src/components/auth/create-account-form.tsx');
const { LoginForm } = await import('../../../src/components/auth/login-form.tsx');

const INVITE_ONLY_LINE = 'Orbit is invitation-only. Ask a workspace admin to invite you.';

function codeSentToast(email: string) {
  return { title: 'Check your email', description: `We sent a 6-digit code to ${email}.` };
}

function mockFetch(status: number, body: unknown): ReturnType<typeof mock> {
  const spy = mock(() => {
    order.push('password');
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  order.length = 0;
  sendVerificationOtp.mockReset();
  signInEmailOtp.mockReset();
  getSession.mockReset();
  listAccounts.mockReset();
  toast.mockReset();
  assign.mockReset();
  sendVerificationOtp.mockResolvedValue({ error: null });
  signInEmailOtp.mockResolvedValue({ error: null });
  getSession.mockResolvedValue({ error: null, data: { user: { emailVerified: true } } });
  listAccounts.mockResolvedValue({ error: null, data: [] });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

async function createAccount(
  user: ReturnType<typeof userEvent.setup>,
  password = 'twelve-characters-long',
) {
  if (password.length > 0) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await user.type(await screen.findByLabelText('Sign in code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('CreateAccountForm', () => {
  it('requests a code, verifies it, checks the accounts, sets the password, then leaves', async () => {
    const fetchSpy = mockFetch(200, { ok: true });
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Create your Orbit account',
    );
    expect(screen.getByText('The first account becomes the admin.')).toBeVisible();

    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await createAccount(user);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/my-issues'));
    expect(sendVerificationOtp).toHaveBeenCalledWith({
      email: 'owner@example.test',
      type: 'sign-in',
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(codeSentToast('owner@example.test'));
    expect(signInEmailOtp).toHaveBeenCalledWith({ email: 'owner@example.test', otp: '123456' });
    expect(getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
    const [url, init] = fetchSpy.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/api/account/password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ newPassword: 'twelve-characters-long' });
    expect(order).toEqual(['send', 'verify', 'list', 'password']);
  });

  it('keeps an existing password and says so, with a Continue button', async () => {
    const fetchSpy = mockFetch(200, { ok: true });
    listAccounts.mockResolvedValue({ error: null, data: [{ providerId: 'credential' }] });
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
      />,
    );
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await createAccount(user);

    expect(
      await screen.findByText(
        'You already had an Orbit account, so your password is unchanged. Use Forgot password? on the sign-in page to change it.',
      ),
    ).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(assign).toHaveBeenCalledWith('/my-issues');
  });

  it('says when the password was not saved, and still lets the user continue', async () => {
    mockFetch(500, { error: { code: 'internal', message: 'Something went wrong on our side.' } });
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
      />,
    );
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await createAccount(user);

    expect(
      await screen.findByText(
        "Your account is ready, but the password wasn't saved. Set one in Settings › Account › Password.",
      ),
    ).toBeVisible();
    expect(assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(assign).toHaveBeenCalledWith('/my-issues');
  });

  it('locks the invited address, hides "Use another email", and returns to the invitation', async () => {
    mockFetch(200, { ok: true });
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="invited"
        lockEmail
        providers={[]}
        passwordEnabled
        emailEnabled
        initialEmail="invited@example.test"
        callbackUrl="/invite/tok"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create your account');
    expect(screen.getByText('Then join the workspace you were invited to.')).toBeVisible();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('readonly');
    await user.type(screen.getByLabelText('Password'), 'twelve-characters-long');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByLabelText('Sign in code');
    expect(screen.queryByText('Use another email')).toBeNull();
    expect(toast).toHaveBeenCalledWith(codeSentToast('invited@example.test'));
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenNthCalledWith(2, codeSentToast('invited@example.test'));
    expect(sendVerificationOtp).toHaveBeenCalledTimes(2);
    await user.type(screen.getByLabelText('Sign in code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/invite/tok'));
    expect(sendVerificationOtp).toHaveBeenCalledWith({
      email: 'invited@example.test',
      type: 'sign-in',
    });
  });

  it('is email and code only when password sign-in is off', async () => {
    const fetchSpy = mockFetch(200, { ok: true });
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled={false}
        emailEnabled
      />,
    );
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await createAccount(user, '');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/my-issues'));
    expect(listAccounts).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('toasts a refused code request and a refused Verify, and stays where it is', async () => {
    sendVerificationOtp.mockResolvedValueOnce({
      error: { message: 'Orbit is invitation-only. Ask a workspace admin to invite you.' },
    });
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
      />,
    );
    await user.type(screen.getByLabelText('Email address'), 'stranger@example.test');
    await user.type(screen.getByLabelText('Password'), 'twelve-characters-long');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'Sign up failed',
        description: 'Orbit is invitation-only. Ask a workspace admin to invite you.',
        tone: 'danger',
      }),
    );
    expect(screen.queryByLabelText('Sign in code')).toBeNull();

    signInEmailOtp.mockResolvedValueOnce({
      error: { message: 'Orbit is invitation-only. Ask a workspace admin to invite you.' },
    });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(await screen.findByLabelText('Sign in code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(3));
    expect(toast).toHaveBeenLastCalledWith({
      title: 'Sign up failed',
      description: 'Orbit is invitation-only. Ask a workspace admin to invite you.',
      tone: 'danger',
    });
    expect(screen.getByLabelText('Sign in code')).toBeVisible();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps Create account disabled until the password has 12 characters', async () => {
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
      />,
    );
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'eleven-char');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), 's');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('refuses an unverified session after Verify and sets no password', async () => {
    const fetchSpy = mockFetch(200, { ok: true });
    getSession.mockResolvedValue({ error: null, data: { user: { emailVerified: false } } });
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
      />,
    );
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await createAccount(user);

    await waitFor(() =>
      expect(toast).toHaveBeenLastCalledWith({
        title: 'Sign up failed',
        description: 'Could not confirm your verified session. Sign in again.',
        tone: 'danger',
      }),
    );
    expect(getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
    expect(order).toEqual(['send', 'verify']);
    expect(listAccounts).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Sign in code')).toBeVisible();
  });

  it('switches to the sign-in form and back', async () => {
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
      />,
    );
    await user.click(screen.getByText('I already have an account'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to Orbit');
    await user.click(screen.getByText('Create an account'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Create your Orbit account',
    );
  });

  it('keeps the invitation-only line on the sign-in form alone', () => {
    render(<LoginForm providers={[]} passwordEnabled emailEnabled inviteOnly />);
    expect(screen.getByText(INVITE_ONLY_LINE)).toBeVisible();
  });

  it('drops the invitation-only line on the sign-in form it switches to', async () => {
    const user = userEvent.setup();
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled
        inviteOnly
      />,
    );
    await user.click(screen.getByText('I already have an account'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to Orbit');
    expect(screen.getByText('Create an account')).toBeVisible();
    expect(screen.queryByText(INVITE_ONLY_LINE)).toBeNull();
  });

  it('explains what to fill when email is not configured', () => {
    render(
      <CreateAccountForm
        mode="first-account"
        lockEmail={false}
        providers={[]}
        passwordEnabled
        emailEnabled={false}
      />,
    );
    expect(
      screen.getByText(
        "Accounts can't be created until email is set up: fill RESEND_API_KEY and EMAIL_FROM.",
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText('Email address')).toBeNull();
  });
});
