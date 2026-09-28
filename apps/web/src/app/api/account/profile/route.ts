import { updateProfile } from '@orbit/core';
import { unauthorized } from '@orbit/shared/errors';
import { headers } from 'next/headers';
import { handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { republishMemberships } from '@/lib/api/profile-sync.ts';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

export async function PATCH(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const user = await updateProfile(session.user.id, await readJson(request));

    await publish(await republishMemberships(user));
    await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });

    return {
      user: {
        name: user.name,
        handle: user.handle,
        image: user.image,
        timezone: user.timezone,
      },
    };
  });
}
