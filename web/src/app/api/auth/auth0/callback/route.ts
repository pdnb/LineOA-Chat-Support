import { signToken } from '@/server/auth';
import { AUTH0_COOKIE, AUTH0_COOKIE_PATH, Auth0Flow, baseUrl, exchangeCode, resolveAuth0User, verifyIdToken } from '@/server/auth0';
import { env } from '@/server/env';

function readFlow(req: Request): Auth0Flow | null {
  const raw = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${AUTH0_COOKIE}=`));
  if (!raw) return null;
  try {
    const flow = JSON.parse(decodeURIComponent(raw.slice(AUTH0_COOKIE.length + 1)));
    return typeof flow?.state === 'string' && typeof flow.nonce === 'string' && typeof flow.verifier === 'string' ? flow : null;
  } catch {
    return null;
  }
}

/**
 * Auth0 redirects back here. Every outcome is a redirect to /login: the app JWT goes in the
 * URL fragment (never sent to the server or in Referer), errors as `?error=<code>`.
 */
export async function GET(req: Request): Promise<Response> {
  const base = baseUrl(req);
  const redirect = (location: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: `${base}${location}`, 'Set-Cookie': `${AUTH0_COOKIE}=; Path=${AUTH0_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0` },
    });
  try {
    if (!env.auth0Enabled) return redirect('/login?error=auth0_failed');
    const params = new URL(req.url).searchParams;
    const flow = readFlow(req);
    const code = params.get('code');
    if (params.get('error')) {
      console.warn('[auth0] login error', params.get('error'), params.get('error_description'));
      return redirect('/login?error=auth0_failed');
    }
    if (!flow || !code || params.get('state') !== flow.state) return redirect('/login?error=auth0_failed');

    const idToken = await exchangeCode(code, flow.verifier, `${base}/api/auth/auth0/callback`);
    const result = await resolveAuth0User(await verifyIdToken(idToken, flow.nonce));
    if ('error' in result) return redirect(`/login?error=${result.error}`);
    return redirect(`/login#token=${await signToken(result.user)}`);
  } catch (err) {
    console.error('[auth0] callback failed', err);
    return redirect('/login?error=auth0_failed');
  }
}
