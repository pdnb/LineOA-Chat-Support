import { signToken } from '@/server/auth';
import {
  AUTH0_COOKIE,
  AUTH0_COOKIE_PATH,
  Auth0Flow,
  baseUrl,
  completeDesktopHandoff,
  DesktopResult,
  exchangeCode,
  resolveAuth0User,
  verifyIdToken,
} from '@/server/auth0';
import { env } from '@/server/env';

function readFlow(req: Request): Auth0Flow | null {
  const raw = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${AUTH0_COOKIE}=`));
  if (!raw) return null;
  try {
    const flow = JSON.parse(decodeURIComponent(raw.slice(AUTH0_COOKIE.length + 1)));
    return typeof flow?.state === 'string' &&
      typeof flow.nonce === 'string' &&
      typeof flow.verifier === 'string' &&
      (flow.desktop === undefined || typeof flow.desktop === 'string')
      ? flow
      : null;
  } catch {
    return null;
  }
}

/**
 * Auth0 redirects back here. Every outcome is a redirect to /login: the app JWT goes in the
 * URL fragment (never sent to the server or in Referer), errors as `?error=<code>`.
 * A login the desktop app opened in the browser instead leaves the outcome in its handoff for the app
 * to claim, and the browser only gets `/login?desktop=done[&error=<code>]`.
 */
export async function GET(req: Request): Promise<Response> {
  const base = baseUrl(req);
  const flow = readFlow(req);
  const redirect = (location: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: `${base}${location}`, 'Set-Cookie': `${AUTH0_COOKIE}=; Path=${AUTH0_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0` },
    });
  const finish = (result: DesktopResult) => {
    if (!flow?.desktop) return redirect('token' in result ? `/login#token=${result.token}` : `/login?error=${result.error}`);
    completeDesktopHandoff(flow.desktop, result);
    return redirect('token' in result ? '/login?desktop=done' : `/login?desktop=done&error=${result.error}`);
  };
  try {
    if (!env.auth0Enabled) return finish({ error: 'auth0_failed' });
    const params = new URL(req.url).searchParams;
    const code = params.get('code');
    if (params.get('error')) {
      console.warn('[auth0] login error', params.get('error'), params.get('error_description'));
      return finish({ error: 'auth0_failed' });
    }
    if (!flow || !code || params.get('state') !== flow.state) return finish({ error: 'auth0_failed' });

    const idToken = await exchangeCode(code, flow.verifier, `${base}/api/auth/auth0/callback`);
    const result = await resolveAuth0User(await verifyIdToken(idToken, flow.nonce));
    if ('error' in result) return finish(result);
    return finish({ token: await signToken(result.user) });
  } catch (err) {
    console.error('[auth0] callback failed', err);
    return finish({ error: 'auth0_failed' });
  }
}
