import { JobStatus } from '@prisma/client';

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ['SENT', 'FAILED'],
  SENT: ['ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED'],
  ACCEPTED: ['IN_PROGRESS', 'DONE', 'REJECTED'],
  IN_PROGRESS: ['DONE', 'REJECTED'],
  FAILED: ['SENT', 'FAILED'],
  DONE: [],
  REJECTED: [],
};

/** Statuses a downstream system may report back through the callback endpoint. */
export const CALLBACK_STATUSES: JobStatus[] = ['ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED'];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'รอส่ง',
  SENT: 'ส่งเรื่องแล้ว',
  ACCEPTED: 'รับเรื่องแล้ว',
  IN_PROGRESS: 'กำลังดำเนินการ',
  DONE: 'เสร็จสิ้น',
  REJECTED: 'ไม่สามารถดำเนินการ',
  FAILED: 'ส่งไม่สำเร็จ',
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: JobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Jobs that can be (re)dispatched to their target system. */
export function canDispatch(status: JobStatus): boolean {
  return status === 'DRAFT' || status === 'FAILED';
}
