import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Role } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from './db';
import { env } from './env';

/*
 * Auth0 login (Authorization Code + PKCE). Auth0 only proves who the user is;
 * the console then gets the same app JWT as a password login (signToken).
 */

/** Short-lived cookie holding state, nonce and the PKCE verifier between /login and /callback. */
export const AUTH0_COOKIE = 'cc.auth0';
export const AUTH0_COOKIE_PATH = '/api/auth/auth0';

export interface Auth0Flow {
  state: string;
  nonce: string;
  verifier: string;
  /** Desktop handoff id when the login was started from the desktop app (see startDesktopHandoff). */
  desktop?: string;
}

export interface Auth0Claims {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

function config() {
  const { auth0Domain: domain, auth0ClientId: clientId, auth0ClientSecret: clientSecret } = env;
  if (!domain || !clientId || !clientSecret) throw new Error('Auth0 is not configured');
  return { domain, clientId, clientSecret, issuer: `https://${domain}/` };
}

/** Public origin of the console: PUBLIC_BASE_URL, or the request's own origin. */
export function baseUrl(req: Request) {
  return env.publicBaseUrl || new URL(req.url).origin;
}

export function newFlow(): Auth0Flow {
  const rand = () => randomBytes(32).toString('base64url');
  return { state: rand(), nonce: rand(), verifier: rand() };
}

export function authorizeUrl(flow: Auth0Flow, redirectUri: string) {
  const { domain, clientId } = config();
  const url = new URL(`https://${domain}/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export function logoutUrl(returnTo: string) {
  const { domain, clientId } = config();
  const url = new URL(`https://${domain}/v2/logout`);
  url.search = new URLSearchParams({ client_id: clientId, returnTo }).toString();
  return url.toString();
}

/** Trades the authorization code for tokens and returns the ID token. */
export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<string> {
  const { domain, clientId, clientSecret } = config();
  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) throw new Error(`Auth0 token exchange failed: ${body.error_description ?? body.error ?? res.status}`);
  return body.id_token;
}

let jwks: { domain: string; get: ReturnType<typeof createRemoteJWKSet> } | undefined;

export async function verifyIdToken(idToken: string, nonce: string): Promise<Auth0Claims> {
  const { domain, clientId, issuer } = config();
  if (jwks?.domain !== domain) jwks = { domain, get: createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`)) };
  const { payload } = await jwtVerify(idToken, jwks.get, { issuer, audience: clientId });
  if (payload.nonce !== nonce) throw new Error('ID token nonce mismatch');
  if (!payload.sub) throw new Error('ID token has no subject');
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified: payload.email_verified === true,
  };
}

export type Auth0Result = { user: { id: string; role: Role } } | { error: 'not_registered' | 'email_unverified' };

/**
 * Only accounts an admin created can sign in. An account is matched by its linked Auth0 id,
 * or, on the first Auth0 login, by verified email (then linked so later email changes don't matter).
 */
export async function resolveAuth0User(claims: Auth0Claims): Promise<Auth0Result> {
  const linked = await prisma.user.findUnique({ where: { auth0Sub: claims.sub } });
  if (linked) return linked.isActive ? { user: linked } : { error: 'not_registered' };
  if (!claims.email) return { error: 'not_registered' };
  if (!claims.email_verified) return { error: 'email_unverified' };
  const byEmail = await prisma.user.findUnique({ where: { email: claims.email.toLowerCase() } });
  if (!byEmail || !byEmail.isActive || byEmail.auth0Sub) return { error: 'not_registered' };
  const user = await prisma.user.update({ where: { id: byEmail.id }, data: { auth0Sub: claims.sub } });
  return { user };
}

/*
 * Desktop handoff. The desktop app opens the Auth0 login in the default browser, so the callback can't
 * hand the token back in a redirect. Instead the app starts a handoff (id + secret), puts only the id in
 * the browser URL, and polls with the secret until the callback has stored the outcome. One-time, 10 minutes.
 */
export type DesktopResult = { token: string } | { error: 'not_registered' | 'email_unverified' | 'auth0_failed' };

interface DesktopHandoff {
  secretHash: Buffer;
  expiresAt: number;
  result: DesktopResult | null;
}

const HANDOFF_TTL_MS = 10 * 60_000;
const MAX_HANDOFFS = 1000;

// Shared via globalThis so every route handler bundle sees the same pending logins.
const g = globalThis as typeof globalThis & { __desktopHandoffs?: Map<string, DesktopHandoff> };
const handoffs = (g.__desktopHandoffs ??= new Map());

const sha256 = (s: string) => createHash('sha256').update(s).digest();

function live(id: string): DesktopHandoff | undefined {
  const h = handoffs.get(id);
  if (!h || h.expiresAt > Date.now()) return h;
  handoffs.delete(id);
  return undefined;
}

export function startDesktopHandoff(): { id: string; secret: string } {
  const now = Date.now();
  for (const [id, h] of handoffs) if (h.expiresAt <= now) handoffs.delete(id);
  // Map keeps insertion order: drop the oldest when an unauthenticated caller floods the endpoint.
  while (handoffs.size >= MAX_HANDOFFS) handoffs.delete(handoffs.keys().next().value!);
  const id = randomBytes(32).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  handoffs.set(id, { secretHash: sha256(secret), expiresAt: now + HANDOFF_TTL_MS, result: null });
  return { id, secret };
}

export function isPendingHandoff(id: string): boolean {
  return live(id)?.result === null;
}

export function completeDesktopHandoff(id: string, result: DesktopResult) {
  const h = live(id);
  if (h && h.result === null) h.result = result;
}

/** `undefined` for an unknown/expired id or a wrong secret, `null` while pending, else the outcome (removed once read). */
export function claimDesktopHandoff(id: string, secret: string): DesktopResult | null | undefined {
  const h = live(id);
  if (!h || !timingSafeEqual(h.secretHash, sha256(secret))) return undefined;
  if (h.result) handoffs.delete(id);
  return h.result;
}
