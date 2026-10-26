import { requireUser } from '@/server/auth';
import { CONVERSATION_VIEWS, ConversationView, list } from '@/server/conversations';
import { badRequest, route, searchParams } from '@/server/http';

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const params = searchParams(req);
  const view = (params.get('view') || 'all') as ConversationView;
  if (!CONVERSATION_VIEWS.includes(view)) throw badRequest('Unknown view');
  return list(view, user, params.get('q')?.trim() || undefined, params.get('channelId'));
});
