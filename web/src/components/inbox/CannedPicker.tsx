'use client';

import { Typography } from 'antd';
import { useEffect, useRef } from 'react';
import { CannedReply } from '@/lib/types';

/** `/word` typed alone in the composer opens the picker; returns the word, or null. */
export function cannedQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Shortcut prefix matches first, then matches anywhere in the title or text. */
export function filterCanned(items: CannedReply[], query: string): CannedReply[] {
  if (!query) return items.slice(0, 50);
  const prefix = items.filter((r) => r.shortcut.startsWith(query));
  const rest = items.filter(
    (r) => !r.shortcut.startsWith(query) && (`${r.title ?? ''} ${r.text}`.toLowerCase().includes(query) || r.shortcut.includes(query)),
  );
  return [...prefix, ...rest].slice(0, 50);
}

/** The list above the composer; keyboard handling lives in the composer (↑ ↓ Enter Tab Esc). */
export function CannedPicker({
  items,
  active,
  onPick,
  onHover,
}: {
  items: CannedReply[];
  active: number;
  onPick(item: CannedReply): void;
  onHover(index: number): void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="ข้อความสำเร็จรูป"
      className="scroll-thin"
      style={{
        position: 'absolute',
        insetInline: 12,
        bottom: '100%',
        marginBottom: 4,
        maxHeight: 280,
        overflowY: 'auto',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,.12)',
        zIndex: 20,
        padding: 4,
      }}
    >
      {items.length === 0 ? (
        <Typography.Text type="secondary" style={{ display: 'block', padding: '8px 10px' }}>
          ไม่พบข้อความสำเร็จรูป
        </Typography.Text>
      ) : (
        items.map((r, i) => (
          <div
            key={r.id}
            role="option"
            aria-selected={i === active}
            data-index={i}
            onMouseEnter={() => onHover(i)}
            // mousedown keeps focus in the textarea
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(r);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              background: i === active ? 'var(--brand-soft)' : undefined,
            }}
          >
            <Typography.Text code>/{r.shortcut}</Typography.Text>{' '}
            {r.title && <Typography.Text strong>{r.title}</Typography.Text>}
            <Typography.Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
              {r.text}
            </Typography.Text>
          </div>
        ))
      )}
    </div>
  );
}
