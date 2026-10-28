import { describe, expect, it } from 'vitest';
import { fillCanned, fillTemplate } from './template';

describe('templates', () => {
  it('fillTemplate blanks unknown keys', () => {
    expect(fillTemplate('{number} {x}', { number: 'JOB-1' })).toBe('JOB-1 ');
  });

  it('fillCanned keeps unknown placeholders and blanks known empty ones', () => {
    expect(fillCanned('สวัสดีคุณ {name} ผม {agent} {order}', { name: 'สมชาย', agent: null })).toBe('สวัสดีคุณ สมชาย ผม  {order}');
  });
});
