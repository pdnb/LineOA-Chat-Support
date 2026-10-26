import { baseUrl, logoutUrl } from '@/server/auth0';
import { env } from '@/server/env';

/** Ends the Auth0 session too, so the next Auth0 login asks for credentials again. */
export function GET(req: Request): Response {
  const login = `${baseUrl(req)}/login`;
  return Response.redirect(env.auth0Enabled ? logoutUrl(login) : login, 302);
}
