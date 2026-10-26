import { requireUser } from '@/server/auth';
import { route, searchParams } from '@/server/http';
import { reportSummary } from '@/server/reports';

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return reportSummary(searchParams(req).get('days'), user.channelIds);
});
