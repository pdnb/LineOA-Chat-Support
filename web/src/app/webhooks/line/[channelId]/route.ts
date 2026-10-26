import { route } from '@/server/http';
import { receiveWebhook } from '@/server/line/webhook';

/** Webhook URL of one LINE OA (shown on the admin "บัญชี LINE OA" page). */
export const POST = route<{ channelId: string }>((req, { channelId }) => receiveWebhook(req, channelId));
