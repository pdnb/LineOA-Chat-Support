import { requireUser } from '@/server/auth';
import { CannedReplyBody, deleteCanned, updateCanned } from '@/server/canned';
import { parseBody, route } from '@/server/http';

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  return updateCanned(user, id, await parseBody(req, CannedReplyBody));
});

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  await deleteCanned(await requireUser(req, 'ADMIN'), id);
});
