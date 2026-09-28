import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session.ts';

export default async function HomeLandingPage() {
  redirect((await getSession()) === null ? '/login' : '/my-issues');
}
