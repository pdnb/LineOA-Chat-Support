import { AUTH0_COOKIE, AUTH0_COOKIE_PATH, authorizeUrl, baseUrl, isPendingHandoff, newFlow } from '@/server/auth0';
import { env } from '@/server/env';
import { notFound, route, searchParams } from '@/server/http';

/**
 * Starts the Auth0 login: remembers state/nonce/PKCE verifier in a short-lived cookie and redirects to Auth0.
 * `?desktop=<handoff id>` marks a login the desktop app opened in the browser.
 */
export const GET = route(async (req) => {
  if (!env.auth0Enabled) throw notFound();
  const flow = newFlow();
  const desktop = searchParams(req).get('desktop');
  if (desktop && isPendingHandoff(desktop)) flow.desktop = desktop;
  const base = baseUrl(req);
  const cookie = [
    `${AUTH0_COOKIE}=${encodeURIComponent(JSON.stringify(flow))}`,
    `Path=${AUTH0_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
    ...(base.startsWith('https:') ? ['Secure'] : []),
  ].join('; ');
  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl(flow, `${base}/api/auth/auth0/callback`), 'Set-Cookie': cookie },
  });
});
