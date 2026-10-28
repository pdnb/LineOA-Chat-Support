'use client';

import { SmileOutlined } from '@ant-design/icons';
import { Button, Popover, Tabs, Tooltip } from 'antd';
import { useState } from 'react';
import { STICKER_PACKAGES, stickerIds, stickerImageUrl } from '@/lib/stickers';

/** LINE's sendable sticker packages, one tab each; picking a sticker sends it right away. */
export function StickerPicker({ onPick, loading }: { onPick(packageId: number, stickerId: number): void; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  const content = (
    <Tabs
      size="small"
      style={{ width: 'min(360px, 80vw)' }}
      items={STICKER_PACKAGES.map((p) => ({
        key: String(p.packageId),
        label: <img src={stickerImageUrl(p.first)} alt="" width={28} height={28} style={{ objectFit: 'contain' }} />,
        children: (
          <div className="scroll-thin" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
            {stickerIds(p).map((id) => (
              <button
                key={id}
                type="button"
                aria-label={`สติกเกอร์ ${id}`}
                onClick={() => {
                  onPick(p.packageId, id);
                  setOpen(false);
                }}
                style={{ border: 0, background: 'none', padding: 4, borderRadius: 8, cursor: 'pointer' }}
              >
                <img src={stickerImageUrl(id)} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
              </button>
            ))}
          </div>
        ),
      }))}
    />
  );
  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="topLeft" destroyOnHidden>
      <Tooltip title="ส่งสติกเกอร์">
        <Button type="text" icon={<SmileOutlined />} loading={loading} aria-label="ส่งสติกเกอร์" />
      </Tooltip>
    </Popover>
  );
}
