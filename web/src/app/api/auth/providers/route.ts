import { env } from '@/server/env';
import { route } from '@/server/http';

/** Public: which login methods the login page should offer. */
export const GET = route(() => ({ auth0: env.auth0Enabled }));
