import { TriangleAlert } from 'lucide-react';

export function DevAccountNotice({ email, password }: { email: string; password: string }) {
  return (
    <details
      open
      data-testid="dev-account-notice"
      className="mt-5 rounded-lg border border-accent/30 bg-accent/10 text-text text-xs"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3.5 py-2.5 font-medium text-accent">
        <TriangleAlert className="size-4" aria-hidden="true" />
        Development mode
      </summary>
      <div className="flex flex-col gap-2 px-3.5 pb-3.5">
        <p>
          The sign-in form is prefilled with the admin account you chose when creating this project:
        </p>
        <p>
          Email <code className="rounded bg-accent/15 px-1.5 py-0.5 font-mono">{email}</code>
        </p>
        <p>
          Password <code className="rounded bg-accent/15 px-1.5 py-0.5 font-mono">{password}</code>
        </p>
        <p>
          The same account is created on your live site the first time it starts. Change the
          password any time in Settings › Account › Password.
        </p>
      </div>
    </details>
  );
}
