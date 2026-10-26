import { messagingApi } from '@line/bot-sdk';
import { Readable } from 'stream';
import { prisma } from '../db';
import { notFound } from '../http';

export type LineMessage = messagingApi.Message;

export interface LineProfile {
  displayName: string;
  pictureUrl?: string;
}

export interface LineBotInfo {
  userId: string;
  basicId: string;
  displayName: string;
  pictureUrl?: string;
}

/** The subset of the LINE Messaging API this system uses (swappable in tests). */
export interface LineClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  push(to: string, messages: LineMessage[]): Promise<void>;
  getProfile(userId: string): Promise<LineProfile | null>;
  getContent(messageId: string): Promise<Buffer | null>;
  getBotInfo(): Promise<LineBotInfo>;
}

export class SdkLineClient implements LineClient {
  private readonly api: messagingApi.MessagingApiClient;
  private readonly blob: messagingApi.MessagingApiBlobClient;

  constructor(channelAccessToken: string) {
    this.api = new messagingApi.MessagingApiClient({ channelAccessToken });
    this.blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken });
  }

  async reply(replyToken: string, messages: LineMessage[]) {
    await this.api.replyMessage({ replyToken, messages });
  }

  async push(to: string, messages: LineMessage[]) {
    await this.api.pushMessage({ to, messages });
  }

  async getProfile(userId: string) {
    try {
      const p = await this.api.getProfile(userId);
      return { displayName: p.displayName, pictureUrl: p.pictureUrl };
    } catch {
      return null;
    }
  }

  async getContent(messageId: string) {
    try {
      const stream = (await this.blob.getMessageContent(messageId)) as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async getBotInfo() {
    const info = await this.api.getBotInfo();
    return { userId: info.userId, basicId: info.basicId, displayName: info.displayName, pictureUrl: info.pictureUrl };
  }
}

/** Used when a channel has no access token: logs instead of calling LINE. */
export class StubLineClient implements LineClient {
  readonly sent: { kind: 'reply' | 'push'; to: string; messages: LineMessage[] }[] = [];

  constructor(private readonly label = 'stub') {}

  async reply(replyToken: string, messages: LineMessage[]) {
    this.sent.push({ kind: 'reply', to: replyToken, messages });
    console.log(`[StubLineClient:${this.label}] reply(${replyToken}) ${JSON.stringify(messages)}`);
  }

  async push(to: string, messages: LineMessage[]) {
    this.sent.push({ kind: 'push', to, messages });
    console.log(`[StubLineClient:${this.label}] push(${to}) ${JSON.stringify(messages)}`);
  }

  async getProfile(userId: string) {
    return { displayName: `LINE user ${userId.slice(-4)}` };
  }

  async getContent() {
    return null;
  }

  async getBotInfo(): Promise<LineBotInfo> {
    throw new Error('ยังไม่ได้ตั้ง Channel access token');
  }
}

type ClientFactory = (channelId: string) => LineClient;

// Shared via globalThis so route handlers (bundled by Next) and the worker (custom server) use one cache.
const g = globalThis as typeof globalThis & {
  __lineClients?: Map<string, { token: string | null; client: LineClient }>;
  __lineClientFactory?: ClientFactory;
};
const cache = (g.__lineClients ??= new Map());

/** The client for one OA. Cached per channel and rebuilt when its access token changes. */
export async function getLineClient(channelId: string): Promise<LineClient> {
  if (g.__lineClientFactory) return g.__lineClientFactory(channelId);
  const channel = await prisma.lineChannel.findUnique({ where: { id: channelId }, select: { accessToken: true } });
  if (!channel) throw notFound('Unknown LINE channel');
  const token = channel.accessToken || null;
  const hit = cache.get(channelId);
  if (hit && hit.token === token) return hit.client;
  if (!token) console.warn(`[LineClient] channel ${channelId} has no access token — using the console stub client`);
  const client = token ? new SdkLineClient(token) : new StubLineClient(channelId);
  cache.set(channelId, { token, client });
  return client;
}

/** Replace how clients are built (tests); `null` restores the real ones. */
export function setLineClientFactory(factory: ClientFactory | null) {
  g.__lineClientFactory = factory ?? undefined;
}
