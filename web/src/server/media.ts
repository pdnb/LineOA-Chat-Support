import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { env } from './env';

export const UPLOAD_DIR = join(process.cwd(), 'uploads');

const DEFAULT_EXT: Record<string, string> = { image: '.jpg', video: '.mp4', audio: '.m4a' };

/** Saves files under ./uploads, served publicly at /media/<name> (names are unguessable UUIDs). */
export async function saveMedia(data: Buffer, ext: string): Promise<{ path: string; url: string }> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}${ext.startsWith('.') ? ext : '.' + ext}`;
  await fs.writeFile(join(UPLOAD_DIR, name), data);
  return { path: `/media/${name}`, url: publicUrl(`/media/${name}`) };
}

export function publicUrl(path: string) {
  return `${env.publicBaseUrl}${path}`;
}

export function extFor(type: string, fileName?: string) {
  if (fileName && extname(fileName)) return extname(fileName);
  return DEFAULT_EXT[type] ?? '.bin';
}
