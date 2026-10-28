import { startDesktopHandoff } from '@/server/auth0';
import { env } from '@/server/env';
import { notFound, route } from '@/server/http';

/** Desktop app: starts a browser login. The app opens `/api/auth/auth0/login?desktop=<id>` and keeps the secret to claim the result. */
export const POST = route(() => {
  if (!env.auth0Enabled) throw notFound();
  return startDesktopHandoff();
});
