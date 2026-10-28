import { describe, expect, it } from 'vitest';
import { csatFlex, parseCsatPostback } from './csat';

const ID = '3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f';

describe('csat', () => {
  it('parses rating postbacks', () => {
    expect(parseCsatPostback(`action=csat&c=${ID}&r=4`)).toEqual({ conversationId: ID, rating: 4 });
  });

  it('rejects other actions, bad ids and out-of-range ratings', () => {
    expect(parseCsatPostback(`action=cat&c=${ID}&r=4`)).toBeNull();
    expect(parseCsatPostback('action=csat&c=nope&r=4')).toBeNull();
    expect(parseCsatPostback(`action=csat&c=${ID}&r=0`)).toBeNull();
    expect(parseCsatPostback(`action=csat&c=${ID}&r=6`)).toBeNull();
    expect(parseCsatPostback(`action=csat&c=${ID}&r=2.5`)).toBeNull();
  });

  it('builds a card with five postback buttons within LINE limits', () => {
    const flex = csatFlex(ID, 'พอใจไหมคะ') as any;
    const buttons = flex.contents.body.contents[2].contents;
    expect(buttons).toHaveLength(5);
    for (const [i, b] of buttons.entries()) {
      expect(parseCsatPostback(b.action.data)).toEqual({ conversationId: ID, rating: i + 1 });
      expect(b.action.data.length).toBeLessThanOrEqual(300);
    }
    expect(flex.altText).toBe('พอใจไหมคะ');
  });
});
