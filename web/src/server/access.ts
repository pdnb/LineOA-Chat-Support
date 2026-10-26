import { Prisma } from '@prisma/client';
import { AuthUser } from './auth';
import { prisma } from './db';
import { notFound } from './http';

/*
 * Agents only see the LINE OAs they are assigned to; admins see all of them.
 * Records outside a user's OAs answer 404, as if they didn't exist.
 */

export function canSeeChannel(user: Pick<AuthUser, 'channelIds'>, channelId: string) {
  return !user.channelIds || user.channelIds.includes(channelId);
}

/** `channelId` filter for the OAs the user may see, narrowed to `requested` (a UI filter) when given. */
export function channelScope(user: Pick<AuthUser, 'channelIds'>, requested?: string | null): Prisma.StringFilter | undefined {
  if (requested) return canSeeChannel(user, requested) ? { equals: requested } : { in: [] };
  return user.channelIds ? { in: user.channelIds } : undefined;
}

export async function assertConversationAccess(user: AuthUser, conversationId: string) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { channelId: true } });
  if (!conv || !canSeeChannel(user, conv.channelId)) throw notFound('Conversation not found');
}

export async function assertContactAccess(user: AuthUser, contactId: string) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { channelId: true } });
  if (!contact || !canSeeChannel(user, contact.channelId)) throw notFound('Contact not found');
}

export async function assertJobAccess(user: AuthUser, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { contact: { select: { channelId: true } } } });
  if (!job || !canSeeChannel(user, job.contact.channelId)) throw notFound('Job not found');
}
