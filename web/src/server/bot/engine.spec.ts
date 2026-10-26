import { describe, expect, it } from 'vitest';
import { BotCategory, BotContext, BotInput, BotState, decide, isTrackInput } from './engine';

const repair: BotCategory = {
  id: 'cat-repair',
  code: 'repair',
  name: 'แจ้งซ่อม',
  canAutoCreate: true,
  form: [
    { key: 'location', label: 'สถานที่', required: true },
    { key: 'detail', label: 'รายละเอียด', required: true },
    { key: 'phone', label: 'เบอร์ติดต่อ', required: false },
  ],
};
const inquiry: BotCategory = { id: 'cat-inq', code: 'inquiry', name: 'สอบถาม', canAutoCreate: false, form: [] };

function ctx(input: BotInput, state: BotState | null = null, collected: Record<string, string> = {}): BotContext {
  return { input, state, collected, categories: [repair, inquiry], greeting: 'สวัสดี', handoffText: 'โอนให้เจ้าหน้าที่' };
}

const textOf = (d: ReturnType<typeof decide>, i = 0) => (d.replies[i] as { text: string }).text;

describe('bot engine', () => {
  it('greets with a quick-reply menu on first contact', () => {
    const d = decide(ctx({ kind: 'text', text: 'hello' }));
    expect(d.state).toEqual({ step: 'MENU' });
    expect(d.action).toBe('none');
    const items = (d.replies[0] as any).quickReply.items;
    expect(items.map((i: any) => i.action.data)).toEqual([
      'action=cat&code=repair',
      'action=cat&code=inquiry',
      'action=track',
      'action=handoff',
    ]);
  });

  it('walks a category form, supports skipping optional fields, then confirms into create_job', () => {
    let d = decide(ctx({ kind: 'postback', data: 'action=cat&code=repair' }, { step: 'MENU' }));
    expect(d.state).toEqual({ step: 'FORM', categoryId: 'cat-repair', fieldIndex: 0 });
    expect(textOf(d, 1)).toContain('สถานที่');

    d = decide(ctx({ kind: 'text', text: 'อาคาร 5 ชั้น 2' }, d.state, d.collected));
    expect(d.collected).toEqual({ location: 'อาคาร 5 ชั้น 2' });

    // Required field cannot be skipped.
    const stuck = decide(ctx({ kind: 'postback', data: 'action=skip' }, d.state, d.collected));
    expect(stuck.state).toEqual(d.state);

    d = decide(ctx({ kind: 'text', text: 'แอร์ไม่เย็น' }, d.state, d.collected));
    d = decide(ctx({ kind: 'postback', data: 'action=skip' }, d.state, d.collected));
    expect(d.state).toEqual({ step: 'CONFIRM', categoryId: 'cat-repair' });
    expect(textOf(d)).toContain('• รายละเอียด: แอร์ไม่เย็น');
    expect(textOf(d)).toContain('• เบอร์ติดต่อ: -');

    d = decide(ctx({ kind: 'postback', data: 'action=confirm' }, d.state, d.collected));
    expect(d.action).toBe('create_job');
    expect(d.categoryId).toBe('cat-repair');
    expect(d.collected.location).toBe('อาคาร 5 ชั้น 2');
  });

  it('hands off to an agent when the category cannot auto-create a job', () => {
    let d = decide(ctx({ kind: 'postback', data: 'action=cat&code=inquiry' }, { step: 'MENU' }));
    expect(d.state).toEqual({ step: 'CONFIRM', categoryId: 'cat-inq' });
    d = decide(ctx({ kind: 'postback', data: 'action=confirm' }, d.state, d.collected));
    expect(d.action).toBe('handoff');
    expect(d.state).toBeNull();
  });

  it('handles keywords at any step', () => {
    const inForm: BotState = { step: 'FORM', categoryId: 'cat-repair', fieldIndex: 1 };
    expect(decide(ctx({ kind: 'text', text: 'ยกเลิก' }, inForm, { location: 'x' })).state).toEqual({ step: 'MENU' });
    expect(decide(ctx({ kind: 'text', text: 'เจ้าหน้าที่' }, inForm)).action).toBe('handoff');
    const track = decide(ctx({ kind: 'text', text: 'ติดตามงาน' }, inForm, { location: 'x' }));
    expect(track.action).toBe('track');
    expect(track.state).toEqual(inForm); // tracking doesn't lose form progress
    expect(isTrackInput({ kind: 'postback', data: 'action=track' })).toBe(true);
    expect(isTrackInput({ kind: 'text', text: 'แอร์เสีย' })).toBe(false);
  });

  it('re-asks the current field for non-text input', () => {
    const inForm: BotState = { step: 'FORM', categoryId: 'cat-repair', fieldIndex: 1 };
    const d = decide(ctx({ kind: 'other' }, inForm, { location: 'x' }));
    expect(d.state).toEqual(inForm);
    expect(textOf(d)).toContain('รายละเอียด');
  });
});
