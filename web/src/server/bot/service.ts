import { Contact, Conversation, Prisma } from '@prisma/client';
import * as conversations from '../conversations';
import { prisma } from '../db';
import { JOB_STATUS_LABELS } from '../job-status';
import { createJob, recentForContact } from '../jobs';
import { LineMessage } from '../line/client';
import { getSetting } from '../settings';
import { BotCategory, BotInput, BotState, decide, FormField, summarize } from './engine';

export async function handleBot(conv: Conversation, contact: Contact, input: BotInput, replyToken?: string) {
  const categories = await activeCategories();
  // Each OA may override the shared bot texts.
  const channel = await prisma.lineChannel.findUnique({
    where: { id: contact.channelId },
    select: { greeting: true, handoffText: true },
  });
  const decision = decide({
    state: conv.botState as BotState | null,
    collected: (conv.collected as Record<string, string> | null) ?? {},
    categories,
    input,
    greeting: channel?.greeting || (await getSetting('bot.greeting')),
    handoffText: channel?.handoffText || (await getSetting('bot.handoffText')),
  });

  // Only touch bot state while the bot owns the conversation (tracking also works mid-chat with an agent).
  if (conv.status === 'BOT') {
    await conversations.updateBot(conv.id, {
      botState: decision.state as Prisma.InputJsonValue | null,
      collected: decision.collected,
      categoryId: decision.categoryId ?? conv.categoryId,
    });
  }

  const replies: LineMessage[] = [...decision.replies];
  if (decision.action === 'track') replies.push(await trackMessage(contact.id));
  if (decision.action === 'create_job') {
    const category = categories.find((c) => c.id === decision.categoryId)!;
    const job = await createJob({
      contactId: contact.id,
      conversationId: conv.id,
      categoryId: category.id,
      title: category.name,
      detail: summarize(category, decision.collected),
      payload: decision.collected,
    });
    replies.push({
      type: 'text',
      text: `บันทึกเรื่องเรียบร้อยค่ะ\nเลขที่งาน: ${job.number}\nระบบจะแจ้งความคืบหน้าให้ทราบทางแชตนี้ พิมพ์ "ติดตามงาน" เพื่อตรวจสอบสถานะได้ตลอดเวลาค่ะ`,
    });
  }

  await conversations.send(conv, contact, replies.slice(0, 5), { replyToken, senderType: 'BOT' });
  if (decision.action === 'handoff') await conversations.handoff(conv.id);
}

async function activeCategories(): Promise<BotCategory[]> {
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    include: { integration: { select: { isActive: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    form: (c.form as unknown as FormField[]) ?? [],
    canAutoCreate: c.autoCreateJob && !!c.integration?.isActive,
  }));
}

async function trackMessage(contactId: string): Promise<LineMessage> {
  const jobs = await recentForContact(contactId, 5);
  if (!jobs.length) return { type: 'text', text: 'ยังไม่มีงานที่เปิดไว้ค่ะ' };
  const lines = jobs.map((j) => `• ${j.number} ${j.title}\n   สถานะ: ${JOB_STATUS_LABELS[j.status]}`);
  return { type: 'text', text: `งานล่าสุดของคุณ\n\n${lines.join('\n')}` };
}
