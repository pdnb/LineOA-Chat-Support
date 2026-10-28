'use client';

/*
 * Browser side of agent attachments (see server/attachments.ts): LINE needs a preview image for
 * video and the duration of audio, which the browser can read from the file before uploading.
 */

export const ATTACH_ACCEPT = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4',
  audio: '.m4a,audio/mp4,audio/x-m4a',
  file: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip',
} as const;

export type AttachKind = keyof typeof ATTACH_ACCEPT;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** A JPEG frame from about one second in, scaled to ≤ 640px wide; null if the browser can't decode it. */
function videoFrame(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = url;
  const frame = new Promise<Blob | null>((resolve) => {
    video.onerror = () => resolve(null);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 2);
    };
    video.onseeked = () => {
      const scale = Math.min(1, 640 / (video.videoWidth || 640));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((video.videoWidth || 640) * scale);
      canvas.height = Math.round((video.videoHeight || 360) * scale);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
    };
  });
  return withTimeout(frame, 5000, null).finally(() => URL.revokeObjectURL(url));
}

function audioDurationMs(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  const duration = new Promise<number | null>((resolve) => {
    audio.onerror = () => resolve(null);
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
  });
  audio.preload = 'metadata';
  audio.src = url;
  return withTimeout(duration, 5000, null).finally(() => URL.revokeObjectURL(url));
}

/** Multipart body for POST /api/conversations/:id/attachments. */
export async function attachmentForm(file: File, kind: AttachKind): Promise<FormData> {
  const fd = new FormData();
  fd.append('file', file);
  if (kind === 'video') {
    const preview = await videoFrame(file);
    if (preview) fd.append('preview', preview, 'preview.jpg');
  }
  if (kind === 'audio') {
    const ms = await audioDurationMs(file);
    if (ms) fd.append('duration', String(ms));
  }
  return fd;
}
