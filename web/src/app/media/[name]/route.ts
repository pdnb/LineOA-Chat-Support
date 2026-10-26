import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { notFound, route } from '@/server/http';
import { UPLOAD_DIR } from '@/server/media';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

/** Public media (LINE needs these URLs for images agents send). Names are random UUIDs. */
export const GET = route<{ name: string }>(async (_req, { name }) => {
  if (!/^[0-9a-f-]{36}\.[A-Za-z0-9]{1,8}$/.test(name)) throw notFound();
  const data = await fs.readFile(join(UPLOAD_DIR, name)).catch(() => null);
  if (!data) throw notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
