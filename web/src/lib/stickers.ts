/**
 * Stickers a LINE OA may send through the Messaging API: only the packages on LINE's
 * "List of available stickers" (developers.line.biz/en/docs/messaging-api/sticker-list/).
 * Each package's sticker ids are one consecutive range.
 */
export const STICKER_PACKAGES: { packageId: number; first: number; last: number }[] = [
  { packageId: 446, first: 1988, last: 2027 },
  { packageId: 789, first: 10855, last: 10894 },
  { packageId: 1070, first: 17839, last: 17878 },
  { packageId: 6136, first: 10551376, last: 10551399 },
  { packageId: 6325, first: 10979904, last: 10979927 },
  { packageId: 6359, first: 11069848, last: 11069871 },
  { packageId: 6362, first: 11087920, last: 11087943 },
  { packageId: 6370, first: 11088016, last: 11088039 },
  { packageId: 6632, first: 11825374, last: 11825397 },
  { packageId: 8515, first: 16581242, last: 16581265 },
  { packageId: 8522, first: 16581266, last: 16581289 },
  { packageId: 8525, first: 16581290, last: 16581313 },
  { packageId: 11537, first: 52002734, last: 52002773 },
  { packageId: 11538, first: 51626494, last: 51626533 },
  { packageId: 11539, first: 52114110, last: 52114149 },
];

export function isSendableSticker(packageId: number | string, stickerId: number | string): boolean {
  const pkg = STICKER_PACKAGES.find((p) => p.packageId === Number(packageId));
  const id = Number(stickerId);
  return !!pkg && Number.isInteger(id) && id >= pkg.first && id <= pkg.last;
}

export function stickerIds(pkg: { first: number; last: number }): number[] {
  return Array.from({ length: pkg.last - pkg.first + 1 }, (_, i) => pkg.first + i);
}

export function stickerImageUrl(stickerId: number | string) {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/android/sticker.png`;
}
