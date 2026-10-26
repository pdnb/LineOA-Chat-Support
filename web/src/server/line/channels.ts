import { LineChannel, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { notFound } from '../http';

/** The OA that existed before multi-OA support; the legacy `/webhooks/line` URL routes here. */
export const DEFAULT_CHANNEL_ID = 'default';

/** Empty strings mean "keep the current value" on update, so secrets never need to be sent back. */
export const LineChannelBody = z.object({
  name: z.string().min(1).max(100),
  channelSecret: z.string().max(200).optional(),
  accessToken: z.string().max(1000).optional(),
  greeting: z.string().max(2000).nullable().optional(),
  handoffText: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function getChannel(id: string) {
  const channel = await prisma.lineChannel.findUnique({ where: { id } });
  if (!channel) throw notFound('Unknown LINE channel');
  return channel;
}

export function webhookUrl(channelId: string) {
  return `${env.publicBaseUrl}/webhooks/line/${channelId}`;
}

/** What the admin console sees: credentials are write-only. */
export function toPublic({ channelSecret, accessToken, ...rest }: LineChannel) {
  return {
    ...rest,
    hasSecret: !!channelSecret,
    tokenHint: accessToken ? accessToken.slice(-4) : null,
    webhookUrl: webhookUrl(rest.id),
  };
}

/** Drop blank credentials and turn blank texts into null (= use the global setting). */
export function toData(dto: z.infer<typeof LineChannelBody>) {
  const { channelSecret, accessToken, greeting, handoffText, ...rest } = dto;
  return {
    ...rest,
    ...(channelSecret?.trim() ? { channelSecret: channelSecret.trim() } : {}),
    ...(accessToken?.trim() ? { accessToken: accessToken.trim() } : {}),
    ...(greeting !== undefined ? { greeting: greeting?.trim() || null } : {}),
    ...(handoffText !== undefined ? { handoffText: handoffText?.trim() || null } : {}),
  };
}

/**
 * One-time move of the old single-OA env config into the default channel:
 * fills LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN only where the channel has none.
 */
export async function importEnvCredentials(db: PrismaClient = prisma) {
  const secret = env.lineChannelSecret;
  const token = env.lineAccessToken;
  if (!secret && !token) return;
  const channel = await db.lineChannel.findUnique({ where: { id: DEFAULT_CHANNEL_ID } });
  if (!channel) return;
  const data = {
    ...(secret && !channel.channelSecret ? { channelSecret: secret } : {}),
    ...(token && !channel.accessToken ? { accessToken: token } : {}),
  };
  if (!Object.keys(data).length) return;
  await db.lineChannel.update({ where: { id: DEFAULT_CHANNEL_ID }, data });
  console.log(`[line] copied ${Object.keys(data).join(', ')} from env into channel "${channel.name}"`);
}
