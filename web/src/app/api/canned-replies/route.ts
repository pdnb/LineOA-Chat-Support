import { requireUser } from '@/server/auth';
import { CannedReplyBody, createCanned, listCanned } from '@/server/canned';
import { parseBody, route, searchParams } from '@/server/http';

/** `?channelId=` narrows to the replies usable in that OA's chats; `?all=1` (admins) includes inactive ones. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const params = searchParams(req);
  return listCanned(user, {
    channelId: params.get('channelId') || null,
    includeInactive: user.role === 'ADMIN' && params.get('all') === '1',
  });
});

export const POST = route(async (req) => {
  const user = await requireUser(req, 'ADMIN');
  return createCanned(user, await parseBody(req, CannedReplyBody));
});
