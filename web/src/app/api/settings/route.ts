import { requireUser } from '@/server/auth';
import { route } from '@/server/http';
import { allSettings } from '@/server/settings';

export const GET = route(async (req) => {
  await requireUser(req);
  return allSettings();
});
