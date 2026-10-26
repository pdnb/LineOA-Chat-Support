import { truncate } from '../text';
import { LineMessage } from '../line/client';

export interface FormField {
  key: string;
  label: string;
  required?: boolean;
}

export interface BotCategory {
  id: string;
  code: string;
  name: string;
  form: FormField[];
  /** Bot may create + dispatch the job itself (category has autoCreateJob and an integration). */
  canAutoCreate: boolean;
}

export type BotStep = 'MENU' | 'FORM' | 'CONFIRM';

export interface BotState {
  step: BotStep;
  categoryId?: string;
  fieldIndex?: number;
}

export type BotInput =
  | { kind: 'text'; text: string }
  | { kind: 'postback'; data: string }
  | { kind: 'follow' }
  | { kind: 'other' };

export type BotAction = 'none' | 'handoff' | 'create_job' | 'track';

export interface BotContext {
  state: BotState | null;
  collected: Record<string, string>;
  categories: BotCategory[];
  input: BotInput;
  greeting: string;
  handoffText: string;
}

export interface BotDecision {
  replies: LineMessage[];
  state: BotState | null;
  collected: Record<string, string>;
  categoryId: string | null;
  action: BotAction;
}

type Intent =
  | { type: 'menu' }
  | { type: 'track' }
  | { type: 'handoff' }
  | { type: 'cancel' }
  | { type: 'confirm' }
  | { type: 'skip' }
  | { type: 'category'; code: string }
  | { type: 'answer'; text: string }
  | { type: 'unsupported' };

const KEYWORDS: Record<'menu' | 'track' | 'handoff' | 'cancel', string[]> = {
  menu: ['เมนู', 'menu', 'เริ่ม', 'start', 'สวัสดี', 'hi', 'hello'],
  track: ['ติดตามงาน', 'ติดตาม', 'สถานะ', 'track'],
  handoff: ['คุยกับเจ้าหน้าที่', 'เจ้าหน้าที่', 'ติดต่อเจ้าหน้าที่', 'agent', 'admin'],
  cancel: ['ยกเลิก', 'cancel'],
};

/** Inputs that the bot always handles, even while a human agent owns the chat. */
export function isTrackInput(input: BotInput): boolean {
  return parseIntent(input).type === 'track';
}

function parseIntent(input: BotInput): Intent {
  if (input.kind === 'follow') return { type: 'menu' };
  if (input.kind === 'other') return { type: 'unsupported' };
  if (input.kind === 'postback') {
    const params = new URLSearchParams(input.data);
    const action = params.get('action');
    if (action === 'cat') return { type: 'category', code: params.get('code') ?? '' };
    if (action === 'menu' || action === 'track' || action === 'handoff' || action === 'cancel' || action === 'confirm' || action === 'skip') {
      return { type: action };
    }
    return { type: 'unsupported' };
  }
  const text = input.text.trim();
  const lower = text.toLowerCase();
  for (const type of ['menu', 'track', 'handoff', 'cancel'] as const) {
    if (KEYWORDS[type].includes(lower)) return { type };
  }
  return { type: 'answer', text };
}

function quick(label: string, data: string) {
  return {
    type: 'action' as const,
    action: { type: 'postback' as const, label: truncate(label, 20), data, displayText: label },
  };
}

function text(t: string, quickReplies: ReturnType<typeof quick>[] = []): LineMessage {
  const msg: LineMessage = { type: 'text', text: truncate(t, 5000) };
  if (quickReplies.length) msg.quickReply = { items: quickReplies.slice(0, 13) };
  return msg;
}

function menuMessage(ctx: BotContext, prefix?: string): LineMessage {
  const items = ctx.categories.slice(0, 11).map((c) => quick(c.name, `action=cat&code=${c.code}`));
  items.push(quick('ติดตามงาน', 'action=track'), quick('คุยกับเจ้าหน้าที่', 'action=handoff'));
  return text(prefix ? `${prefix}\n\n${ctx.greeting}` : ctx.greeting, items);
}

function askField(field: FormField, index: number, total: number): LineMessage {
  const items = [];
  if (!field.required) items.push(quick('ข้าม', 'action=skip'));
  items.push(quick('ยกเลิก', 'action=cancel'), quick('คุยกับเจ้าหน้าที่', 'action=handoff'));
  return text(`(${index + 1}/${total}) กรุณาระบุ${field.label}`, items);
}

export function summarize(category: Pick<BotCategory, 'name' | 'form'>, collected: Record<string, string>): string {
  const lines = category.form.map((f) => `• ${f.label}: ${collected[f.key] || '-'}`);
  return [`เรื่อง: ${category.name}`, ...lines].join('\n');
}

function confirmMessage(category: BotCategory, collected: Record<string, string>): LineMessage {
  const primary = category.canAutoCreate
    ? quick('ยืนยันส่งเรื่อง', 'action=confirm')
    : quick('ส่งให้เจ้าหน้าที่', 'action=confirm');
  return text(`กรุณาตรวจสอบข้อมูล\n\n${summarize(category, collected)}`, [
    primary,
    quick('กรอกใหม่', `action=cat&code=${category.code}`),
    quick('ยกเลิก', 'action=cancel'),
  ]);
}

/**
 * Pure bot state machine: given the current state and the customer's input, decide the replies,
 * the next state and any side effect for the caller to perform (handoff, create job, track).
 */
export function decide(ctx: BotContext): BotDecision {
  const intent = parseIntent(ctx.input);
  const current = ctx.state;
  const category = ctx.categories.find((c) => c.id === current?.categoryId) ?? null;
  const keep = { state: current, collected: ctx.collected, categoryId: category?.id ?? null };
  const toMenu = (replies: LineMessage[], action: BotAction = 'none'): BotDecision => ({
    replies,
    state: { step: 'MENU' },
    collected: {},
    categoryId: null,
    action,
  });

  switch (intent.type) {
    case 'menu':
      return toMenu([menuMessage(ctx)]);
    case 'track':
      return { ...keep, replies: [], action: 'track' };
    case 'handoff':
      return { ...keep, state: null, replies: [text(ctx.handoffText)], action: 'handoff' };
    case 'cancel':
      return toMenu([menuMessage(ctx, 'ยกเลิกรายการแล้วค่ะ')]);
    case 'category': {
      const picked = ctx.categories.find((c) => c.code === intent.code);
      if (!picked) return toMenu([menuMessage(ctx, 'ไม่พบหัวข้อที่เลือก')]);
      if (!picked.form.length) {
        return {
          replies: [confirmMessage(picked, {})],
          state: { step: 'CONFIRM', categoryId: picked.id },
          collected: {},
          categoryId: picked.id,
          action: 'none',
        };
      }
      return {
        replies: [text(`หัวข้อ: ${picked.name}`), askField(picked.form[0], 0, picked.form.length)],
        state: { step: 'FORM', categoryId: picked.id, fieldIndex: 0 },
        collected: {},
        categoryId: picked.id,
        action: 'none',
      };
    }
  }

  if (current?.step === 'FORM' && category) {
    const index = current.fieldIndex ?? 0;
    const field = category.form[index];
    if (intent.type === 'unsupported' || intent.type === 'confirm' || !field) {
      return { ...keep, replies: [askField(field ?? category.form[0], index, category.form.length)], action: 'none' };
    }
    if (intent.type === 'skip' && field.required) {
      return { ...keep, replies: [askField(field, index, category.form.length)], action: 'none' };
    }
    const collected = { ...ctx.collected, [field.key]: intent.type === 'answer' ? intent.text : '' };
    const next = index + 1;
    if (next < category.form.length) {
      return {
        replies: [askField(category.form[next], next, category.form.length)],
        state: { step: 'FORM', categoryId: category.id, fieldIndex: next },
        collected,
        categoryId: category.id,
        action: 'none',
      };
    }
    return {
      replies: [confirmMessage(category, collected)],
      state: { step: 'CONFIRM', categoryId: category.id },
      collected,
      categoryId: category.id,
      action: 'none',
    };
  }

  if (current?.step === 'CONFIRM' && category) {
    if (intent.type === 'confirm') {
      if (category.canAutoCreate) {
        return { replies: [], state: { step: 'MENU' }, collected: ctx.collected, categoryId: category.id, action: 'create_job' };
      }
      return { ...keep, state: null, replies: [text(ctx.handoffText)], action: 'handoff' };
    }
    return { ...keep, replies: [confirmMessage(category, ctx.collected)], action: 'none' };
  }

  // First contact gets the plain greeting; later stray input gets a hint in front of the menu.
  if (!current) return toMenu([menuMessage(ctx)]);
  const prefix = intent.type === 'unsupported' ? 'ขออภัยค่ะ ระบบอัตโนมัติรองรับเฉพาะข้อความ' : 'กรุณาเลือกหัวข้อจากเมนูด้านล่างค่ะ';
  return toMenu([menuMessage(ctx, prefix)]);
}
