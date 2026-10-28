import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { notFound, route } from '@/server/http';
import { UPLOAD_DIR } from '@/server/media';

/** Served types. Anything else (html, svg, …) is never stored, and would only be offered as a download. */
const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

/** Shown inline (LINE and the console embed these); everything else downloads. */
const INLINE = /^(image|video|audio)\//;

/** Public media (LINE needs these URLs for what agents send). Names are random UUIDs. */
export const GET = route<{ name: string }>(async (_req, { name }) => {
  if (!/^[0-9a-f-]{36}\.[A-Za-z0-9]{1,8}$/.test(name)) throw notFound();
  const data = await fs.readFile(join(UPLOAD_DIR, name)).catch(() => null);
  if (!data) throw notFound();
  const type = TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': INLINE.test(type) ? 'inline' : 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
