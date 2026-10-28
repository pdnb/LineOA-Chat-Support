import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { SlaConfig } from '../lib/sla';
import { prisma } from './db';
import { badRequest } from './http';

export type NotifyTemplates = Partial<Record<'SENT' | 'ACCEPTED' | 'IN_PROGRESS' | 'DONE' | 'REJECTED', string>>;

/** Editable settings and their defaults. Only these keys can be read or written over the API. */
export const SETTING_DEFAULTS = {
  'bot.greeting': 'สวัสดีค่ะ ยินดีต้อนรับสู่ศูนย์บริการลูกค้า 🙏\nกรุณาเลือกหัวข้อที่ต้องการติดต่อด้านล่างได้เลยค่ะ',
  'bot.handoffText': 'รับทราบค่ะ กำลังโอนเรื่องให้เจ้าหน้าที่ กรุณารอสักครู่นะคะ',
  'notify.templates': {
    SENT: 'ส่งเรื่อง {number} ไปยังหน่วยงานที่เกี่ยวข้องแล้ว',
    ACCEPTED: 'หน่วยงานรับเรื่อง {number} แล้ว',
    IN_PROGRESS: 'เรื่อง {number} อยู่ระหว่างดำเนินการ',
    DONE: 'เรื่อง {number} ดำเนินการเสร็จสิ้นแล้ว ขอบคุณที่ใช้บริการค่ะ',
    REJECTED: 'ขออภัย เรื่อง {number} ไม่สามารถดำเนินการได้ {note}',
  } as NotifyTemplates,
  /** Alert when a chat waits in the queue, or an assigned chat goes unanswered, longer than this. */
  sla: { enabled: true, queueWaitMinutes: 5, firstResponseMinutes: 10 } as SlaConfig,
  'csat.question': 'คุณพึงพอใจกับการให้บริการครั้งนี้แค่ไหนคะ',
  'csat.thanks': 'ขอบคุณสำหรับคะแนนค่ะ 🙏',
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;

/** Stricter checks than "same type as the default" for structured settings. */
const SETTING_SCHEMAS: Partial<Record<SettingKey, z.ZodType>> = {
  sla: z.object({
    enabled: z.boolean(),
    queueWaitMinutes: z.number().int().min(1).max(1440),
    firstResponseMinutes: z.number().int().min(1).max(1440),
  }),
  'csat.question': z.string().min(1).max(300),
  'csat.thanks': z.string().min(1).max(300),
};

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row?.value as (typeof SETTING_DEFAULTS)[K]) ?? SETTING_DEFAULTS[key];
}

export async function allSettings() {
  const rows = await prisma.setting.findMany();
  const result: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of rows) if (row.key in SETTING_DEFAULTS) result[row.key] = row.value;
  return result;
}

export async function setSetting(key: string, value: unknown) {
  if (!(key in SETTING_DEFAULTS)) throw badRequest(`Unknown setting ${key}`);
  const expected = SETTING_DEFAULTS[key as SettingKey];
  const ok = Array.isArray(expected) ? Array.isArray(value) : typeof value === typeof expected && value !== null;
  if (!ok) throw badRequest(`Invalid value for ${key}`);
  const schema = SETTING_SCHEMAS[key as SettingKey];
  if (schema && !schema.safeParse(value).success) throw badRequest(`Invalid value for ${key}`);
  const json = value as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
  return value;
}
