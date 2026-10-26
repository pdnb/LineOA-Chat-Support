import { Prisma } from '@prisma/client';

export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
  auth0Sub: true,
  channels: { select: { id: true } },
} satisfies Prisma.UserSelect;

/** API shape: the assigned LINE OAs as a flat id list; only whether Auth0 is linked, not the Auth0 id. */
export function toUserDto({ channels, auth0Sub, ...user }: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>) {
  return { ...user, auth0Linked: !!auth0Sub, channelIds: channels.map((c) => c.id) };
}
