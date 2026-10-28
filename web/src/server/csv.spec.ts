import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  const cols = [
    { header: 'ชื่อ', value: (r: any) => r.name },
    { header: 'n', value: (r: any) => r.n },
    { header: 'at', value: (r: any) => r.at },
  ];

  it('starts with a BOM, uses CRLF and quotes per RFC 4180', () => {
    const csv = toCsv(cols, [{ name: 'a, "b"\nc', n: 1, at: null }]);
    expect(csv.startsWith('﻿ชื่อ,n,at\r\n')).toBe(true);
    expect(csv).toContain('"a, ""b""\nc",1,\r\n');
  });

  it('formats dates in Bangkok time', () => {
    expect(toCsv(cols, [{ name: 'x', n: 0, at: new Date('2026-01-01T00:00:00Z') }])).toContain('x,0,2026-01-01 07:00:00');
  });

  it('neutralizes spreadsheet formulas in text but not negative numbers', () => {
    const csv = toCsv(cols, [{ name: '=HYPERLINK("x")', n: -5, at: null }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")",-5,`);
  });
});
