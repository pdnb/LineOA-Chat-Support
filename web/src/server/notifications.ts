import { Job, JobStatus } from '@prisma/client';
import * as conversations from './conversations';
import { prisma } from './db';
import { JOB_STATUS_LABELS } from './job-status';
import { LineMessage } from './line/client';
import { enqueue } from './queue';
import { getSetting, NotifyTemplates } from './settings';
import { fillTemplate, truncate } from './text';

export const LINE_PUSH_QUEUE = 'line-push';

interface PushPayload {
  contactId: string;
  conversationId?: string | null;
  messages: LineMessage[];
}

const STATUS_COLORS: Partial<Record<JobStatus, string>> = {
  SENT: '#2563EB',
  ACCEPTED: '#7C3AED',
  IN_PROGRESS: '#D97706',
  DONE: '#16A34A',
  REJECTED: '#DC2626',
};

export function jobStatusFlex(job: Pick<Job, 'number' | 'title'>, status: JobStatus, text: string): LineMessage {
  const color = STATUS_COLORS[status] ?? '#334155';
  return {
    type: 'flex',
    altText: truncate(text, 400),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: color,
        paddingAll: '16px',
        contents: [
          { type: 'text', text: 'อัปเดตสถานะงาน', color: '#FFFFFF', size: 'sm' },
          { type: 'text', text: JOB_STATUS_LABELS[status], color: '#FFFFFF', size: 'xl', weight: 'bold' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              { type: 'text', text: 'เลขที่', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: job.number, size: 'sm', weight: 'bold', flex: 5 },
            ],
          },
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              { type: 'text', text: 'เรื่อง', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: truncate(job.title, 80), size: 'sm', wrap: true, flex: 5 },
            ],
          },
          { type: 'separator' },
          { type: 'text', text: truncate(text, 400), size: 'sm', wrap: true },
        ],
      },
    },
  } as LineMessage;
}

/** Queue a status card to the customer, if a template exists for this status. */
export async function notifyJobStatus(job: Job, status: JobStatus, note?: string | null) {
  const templates: NotifyTemplates = await getSetting('notify.templates');
  const template = templates[status as keyof NotifyTemplates];
  if (!template) return;
  const text = fillTemplate(template, { number: job.number, title: job.title, note: note ?? '' }).trim();
  await enqueue(LINE_PUSH_QUEUE, {
    contactId: job.contactId,
    conversationId: job.conversationId,
    messages: [jobStatusFlex(job, status, text)],
  } satisfies PushPayload);
}

/** Queue handler: deliver a queued push to the customer's open conversation. */
export async function deliverPush({ contactId, conversationId, messages }: PushPayload) {
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
  const conv =
    (conversationId && (await prisma.conversation.findUnique({ where: { id: conversationId } }))) ||
    (await conversations.getOrOpen(contact));
  await conversations.send(conv, contact, messages, { senderType: 'BOT' });
}
