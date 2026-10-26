import { requireUser } from '@/server/auth';
import { counts } from '@/server/conversations';
import { route, searchParams } from '@/server/http';

export const GET = route(async (req) => counts(await requireUser(req), searchParams(req).get('channelId')));
