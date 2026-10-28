import { describe, expect, it } from 'vitest';
import { isSendableSticker, STICKER_PACKAGES, stickerIds } from './stickers';

describe('stickers', () => {
  it('accepts ids inside an official package range only', () => {
    expect(isSendableSticker(446, 1988)).toBe(true);
    expect(isSendableSticker('446', '2027')).toBe(true);
    expect(isSendableSticker(446, 2028)).toBe(false);
    expect(isSendableSticker(789, 1988)).toBe(false);
    expect(isSendableSticker(1, 1)).toBe(false);
    expect(isSendableSticker(446, 'x')).toBe(false);
  });

  it('lists every id of a package', () => {
    for (const p of STICKER_PACKAGES) expect(stickerIds(p)).toHaveLength(p.last - p.first + 1);
  });
});
