import { redirect } from 'next/navigation';
import { authErrorCode } from '@/lib/auth/oauth-error.ts';
import { getSession } from '@/lib/auth/session.ts';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await getSession()) !== null) redirect('/my-issues');
  const errorCode = authErrorCode((await searchParams)['error']);
  redirect(errorCode === undefined ? '/login' : `/login?error=${encodeURIComponent(errorCode)}`);
}
