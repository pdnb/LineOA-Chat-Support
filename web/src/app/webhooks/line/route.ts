import { route } from '@/server/http';
import { DEFAULT_CHANNEL_ID } from '@/server/line/channels';
import { receiveWebhook } from '@/server/line/webhook';

/** Legacy single-OA webhook URL, kept so existing LINE console settings keep working. */
export const POST = route((req) => receiveWebhook(req, DEFAULT_CHANNEL_ID));
