import { z } from 'zod';
import { claimDesktopHandoff } from '@/server/auth0';
import { env } from '@/server/env';
import { notFound, parseBody, route } from '@/server/http';

const ClaimBody = z.object({ id: z.string().min(1), secret: z.string().min(1) });

/** Desktop app polls here: 202 while the browser login is still running, then `{ token }` or `{ error }` once. */
export const POST = route(async (req) => {
  if (!env.auth0Enabled) throw notFound();
  const { id, secret } = await parseBody(req, ClaimBody);
  const result = claimDesktopHandoff(id, secret);
  if (result === undefined) throw notFound('การเข้าสู่ระบบหมดเวลา กรุณาลองใหม่');
  return result === null ? new Response(null, { status: 202 }) : Response.json(result);
});
