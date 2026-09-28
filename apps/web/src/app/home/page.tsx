import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session.ts';

export default async function HomeRedirectPage() {
  redirect((await getSession()) === null ? '/login' : '/my-issues');
}
