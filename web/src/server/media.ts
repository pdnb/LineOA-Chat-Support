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

/** Dark 'play' placeholder LINE shows for a video sent without a preview frame (480×270 PNG). */
const VIDEO_PREVIEW_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAeAAAAEOCAIAAADe+FMwAAAEbElEQVR42u3du2kDURBAUVXi3LFDRy5C/ZeyBoEyY/wJ9s7OWU4F84aLEPu5vby+AxB0MwIAgQZAoAEEGgCBBhBoAAQaAIEGEGgABBpAoAEQaAAEGkCgARBoAIEGQKABBBoAgQZAoAEEGgCBBhBoAAQaAIEGEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQZAoAEEGgCBBhBoAAQaQKBNAUCgARBoAIEGQKABBBoAgQZAoAEEGgCBBhBoAAQaAIEGEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQZAoAEEGgCBBhBoAAQaQKABEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaFMAEGgABBpAoAEQaACBBkCgARBoruLt4/43RodAQyjKYo1Aw4wuKzUCDQPSLNMINKTTLNMINKTTLNMINKTTLNMINNTrrNEINNJ873NMCDTqrNEg0KizRiPQcI06azQCjTTLNAg06qzRCDQINAg06qzRCDTsrrNGI9Cos0Yj0KDOGo1AI9ACDQKNOms0Ag2L66zRCDQCLdAINKizRiPQCPQPHY9LoBFoyP18Pp6XRiPQEA10PNOOHoFm3b/Px1eXRiPQEA10s9EWAIFm180bx7eXRiPQEA10LdPWAIFGoKONtgYINIseTjl+c2k0Ag3RQBcybRkQaAQ62mjLgEAj0NFMWwYEmhV1/megz8q0lUCgEehoo60EAo1ARzNtJRBoBDqaaSuBQCPQ0UZbCQQagY5m2kog0Ah0NNNWAoFGoKONthIINAIdzbSVQKAR6GimrQQCjUD7BY1Ag/+gBRqBRqDdxQECjfug3QeNQCPQniQEgUagvYsDgYZ5gfY2OwQagfY+aFuBQCPQvqiCQMNZjfZNQgQaLhVoX/VGoKEY6BPrLNAINAJdTLNAI9DsavSgNKszAo1AR+ss0Ag0Al1Ms0Aj0Kxr9JQ0qzMCjUBH6yzQCDTrGj0izeqMQLM60Nk0CzQCzdJGqzMCDQMeWhFoBBo0Wp0RaARaoEGg0Wh1RqBhS6MdMQKNQAs0Ag0arc4INBqtziDQaLQ6I9CwoNGOEoFGoAUagQaNVmcEGuZm2sEh0Gi0OoNAo9HqjEDD3EY7JgQamZZmEGg0Wp0RaJiYaQeBQEMu04aPQEMu0waOQEMu04aMQEOr1EaKQEMo1kaHQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0AAINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAwg0AAINgEADCDQAAg0g0AAINAACDSDQAAg0gEADINAAAm0KAAINgEADCDQAAg0g0AAINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAwg0AAINgEADCDQAAg0g0AAINAACDSDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAINgEADCDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAINgEADCDQAAg1wCZ9tTUKZT5MlnQAAAABJRU5ErkJggg==';
const VIDEO_PREVIEW_NAME = '00000000-0000-0000-0000-000000000000.png';

/** Public URL of the video placeholder, written to the upload dir the first time it is needed. */
export async function videoPreviewFallback(): Promise<string> {
  const file = join(UPLOAD_DIR, VIDEO_PREVIEW_NAME);
  const exists = await fs.stat(file).then(() => true, () => false);
  if (!exists) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(file, Buffer.from(VIDEO_PREVIEW_PNG, 'base64'));
  }
  return publicUrl(`/media/${VIDEO_PREVIEW_NAME}`);
}
