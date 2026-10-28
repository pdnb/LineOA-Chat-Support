import { Contact, Conversation } from '@prisma/client';
import { extname } from 'path';
import { send } from './conversations';
import { env } from './env';
import { badRequest } from './http';
import { LineMessage } from './line/client';
import { saveMedia, videoPreviewFallback } from './media';

/*
 * What agents can attach, and how it reaches the customer. The Messaging API can send images,
 * video (with a preview image) and m4a audio (with its duration), but not arbitrary files:
 * documents go out as a text message with a download link.
 */

const MB = 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * MB;
export const DOCUMENT_MAX_BYTES = 20 * MB;

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png' };
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': '.mp4' };
const AUDIO_TYPES: Record<string, string> = { 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/m4a': '.m4a' };
/** Documents are recognized by extension (browsers report many different types for them). */
export const DOCUMENT_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.zip'];

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

type Kind = 'image' | 'video' | 'audio' | 'document';

export function kindOf(file: Pick<File, 'type' | 'name'>): Kind | null {
  if (IMAGE_TYPES[file.type]) return 'image';
  if (VIDEO_TYPES[file.type]) return 'video';
  const ext = extname(file.name).toLowerCase();
  if (AUDIO_TYPES[file.type] || ext === '.m4a') return 'audio';
  if (DOCUMENT_EXTS.includes(ext)) return 'document';
  return null;
}

const bytes = async (f: File) => Buffer.from(await f.arrayBuffer());

/** Save the upload, send it to the customer and record it in the chat. */
export async function sendAttachment(
  conv: Conversation,
  contact: Contact,
  userId: string,
  file: File,
  extra: { preview?: File | null; durationMs?: number | null } = {},
) {
  const kind = kindOf(file);
  const opts = { senderType: 'AGENT' as const, userId };
  if (!kind) throw badRequest('ไม่รองรับไฟล์ประเภทนี้');

  if (kind === 'image') {
    if (file.size > IMAGE_MAX_BYTES) throw badRequest('รูปภาพต้องมีขนาดไม่เกิน 10MB');
    const saved = await saveMedia(await bytes(file), IMAGE_TYPES[file.type]);
    const message: LineMessage = { type: 'image', originalContentUrl: saved.url, previewImageUrl: saved.url };
    return send(conv, contact, [message], { ...opts, payloads: [{ url: saved.path }] });
  }

  if (kind === 'video' || kind === 'audio') {
    if (file.size > env.mediaMaxMb * MB) throw badRequest(`ไฟล์ต้องมีขนาดไม่เกิน ${env.mediaMaxMb}MB`);
    if (kind === 'audio') {
      const duration = Math.round(extra.durationMs ?? 0);
      if (!(duration > 0)) throw badRequest('ไม่ทราบความยาวของไฟล์เสียง');
      const saved = await saveMedia(await bytes(file), '.m4a');
      return send(conv, contact, [{ type: 'audio', originalContentUrl: saved.url, duration }], {
        ...opts,
        payloads: [{ url: saved.path, duration }],
      });
    }
    // LINE requires a preview image; the console uploads a frame grabbed in the browser.
    const previewUrl =
      extra.preview && IMAGE_TYPES[extra.preview.type] && extra.preview.size <= MB
        ? (await saveMedia(await bytes(extra.preview), IMAGE_TYPES[extra.preview.type])).url
        : await videoPreviewFallback();
    const saved = await saveMedia(await bytes(file), '.mp4');
    return send(conv, contact, [{ type: 'video', originalContentUrl: saved.url, previewImageUrl: previewUrl }], {
      ...opts,
      payloads: [{ url: saved.path }],
    });
  }

  if (file.size > DOCUMENT_MAX_BYTES) throw badRequest('ไฟล์ต้องมีขนาดไม่เกิน 20MB');
  const fileName = file.name.slice(0, 200);
  const saved = await saveMedia(await bytes(file), extname(file.name).toLowerCase());
  const text = `📎 ${fileName} (${formatBytes(file.size)})\n${saved.url}`;
  return send(conv, contact, [{ type: 'text', text }], {
    ...opts,
    payloads: [{ url: saved.path, fileName, size: file.size, sentAs: 'link' }],
    records: [{ type: 'file', text: fileName }],
  });
}
