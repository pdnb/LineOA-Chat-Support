import { ConversationStatus, JobPriority, JobStatus } from './types';

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'รอส่ง', tone: 'neutral' },
  SENT: { label: 'ส่งเรื่องแล้ว', tone: 'blue' },
  ACCEPTED: { label: 'รับเรื่องแล้ว', tone: 'violet' },
  IN_PROGRESS: { label: 'กำลังดำเนินการ', tone: 'amber' },
  DONE: { label: 'เสร็จสิ้น', tone: 'green' },
  REJECTED: { label: 'ไม่ดำเนินการ', tone: 'red' },
  FAILED: { label: 'ส่งไม่สำเร็จ', tone: 'red' },
};

export const CONVERSATION_STATUS: Record<ConversationStatus, { label: string; tone: Tone }> = {
  BOT: { label: 'Bot', tone: 'neutral' },
  QUEUED: { label: 'รอรับเรื่อง', tone: 'amber' },
  ASSIGNED: { label: 'กำลังดูแล', tone: 'blue' },
  RESOLVED: { label: 'ปิดแล้ว', tone: 'green' },
};

export const PRIORITY: Record<JobPriority, string> = {
  LOW: 'ต่ำ',
  NORMAL: 'ปกติ',
  HIGH: 'สูง',
  URGENT: 'ด่วนมาก',
};

export type Tone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red';

const time = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' });

export function fmtTime(iso: string) {
  return time.format(new Date(iso));
}

export function fmtDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}

/** Time today, otherwise short date — for list rows. */
export function fmtRelative(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time.format(d) : date.format(d);
}

export function fmtDuration(seconds: number | null) {
  if (seconds == null) return '-';
  if (seconds < 60) return `${Math.round(seconds)} วินาที`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} นาที`;
  return `${(seconds / 3600).toFixed(1)} ชม.`;
}

/** Ant Design Tag colors for each tone. */
export const TONE_COLOR: Record<Tone, string> = {
  neutral: 'default',
  blue: 'blue',
  violet: 'purple',
  amber: 'gold',
  green: 'green',
  red: 'red',
};
