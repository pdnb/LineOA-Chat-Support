import { requireUser } from '@/server/auth';
import { tagsFor } from '@/server/contacts';
import { route, searchParams } from '@/server/http';

/** Every tag used on the user's contacts, for the inbox tag filter and the tag picker. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return tagsFor(user, searchParams(req).get('channelId'));
});
