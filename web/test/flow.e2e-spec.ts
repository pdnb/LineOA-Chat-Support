/**
 * End-to-end flow against a real Postgres test database (TEST_DATABASE_URL):
 * LINE webhook → bot form → job → signed dispatch to a fake downstream → callback → LINE notification,
 * plus agent handoff, dispatch retry/failure, multiple LINE OAs with per-OA agent access and Auth0 account matching.
 * Route handlers are called directly with Request objects.
 */
import { execSync } from 'child_process';
import { createHmac } from 'crypto';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/linecc_test';
const LINE_SECRET = 'line-test-secret';
const LINE_SECRET_B = 'line-test-secret-branch';
const INTEGRATION_SECRET = 'integration-test-secret-123';

Object.assign(process.env, {
  DATABASE_URL: TEST_DB,
  QUEUE_MAX_ATTEMPTS: '2',
  QUEUE_BACKOFF_MS: '0',
  LINE_CHANNEL_SECRET: '',
  LINE_CHANNEL_ACCESS_TOKEN: '',
  JWT_SECRET: 'test-jwt',
  PUBLIC_BASE_URL: 'https://cc.example.test',
  AUTO_ASSIGN: 'false',
});

type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;

interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

// Loaded after env is set so the Prisma client connects to the test database.
const load = async () => ({
  db: await import('@/server/db'),
  queue: await import('@/server/queue'),
  worker: await import('@/server/worker'),
  line: await import('@/server/line/client'),
  channels: await import('@/server/line/channels'),
  bcrypt: (await import('bcryptjs')).default,
  auth0: await import('@/server/auth0'),
  routes: {
    lineWebhook: await import('@/app/webhooks/line/route'),
    lineChannelWebhook: await import('@/app/webhooks/line/[channelId]/route'),
    counts: await import('@/app/api/conversations/counts/route'),
    assign: await import('@/app/api/conversations/[id]/assign/route'),
    contact: await import('@/app/api/contacts/[id]/route'),
    job: await import('@/app/api/jobs/[id]/route'),
    lineChannels: await import('@/app/api/line-channels/route'),
    lineChannelOptions: await import('@/app/api/line-channels/options/route'),
    jobCallback: await import('@/app/webhooks/jobs/[integrationId]/status/route'),
    login: await import('@/app/api/auth/login/route'),
    providers: await import('@/app/api/auth/providers/route'),
    auth0Login: await import('@/app/api/auth/auth0/login/route'),
    auth0Callback: await import('@/app/api/auth/auth0/callback/route'),
    users: await import('@/app/api/users/route'),
    conversations: await import('@/app/api/conversations/route'),
    conversation: await import('@/app/api/conversations/[id]/route'),
    messages: await import('@/app/api/conversations/[id]/messages/route'),
    handoff: await import('@/app/api/conversations/[id]/handoff/route'),
    report: await import('@/app/api/reports/summary/route'),
    jobs: await import('@/app/api/jobs/route'),
    dispatch: await import('@/app/api/jobs/[id]/dispatch/route'),
    integrations: await import('@/app/api/integrations/route'),
  },
});

async function call(
  handler: Handler,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string>; params?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    headers['content-type'] ??= 'application/json';
  }
  const res = await handler(new Request(`http://test.local${path}`, { method: opts.method ?? 'GET', headers, body }), {
    params: Promise.resolve(opts.params ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('Hotline flow (e2e)', () => {
  let m: Awaited<ReturnType<typeof load>>;
  let prisma: PrismaClient;
  /** Stub LINE client per OA; `line` is the default OA's. */
  const lines: Record<string, InstanceType<typeof m.line.StubLineClient>> = {};
  let line: InstanceType<typeof m.line.StubLineClient>;
  let branchId: string;
  let receiver: Server;
  const received: Received[] = [];
  let receiverStatus = 200;
  let integrationId: string;
  let auth: Record<string, string>;

  const lineSign = (body: string, secret = LINE_SECRET) => createHmac('sha256', secret).update(body).digest('base64');
  const intSign = (body: string) => 'sha256=' + createHmac('sha256', INTEGRATION_SECRET).update(body).digest('hex');

  /** Posts a signed event to an OA's webhook (the default OA unless `channelId` is given). */
  async function lineEvent(userId: string, event: Record<string, unknown>, channelId = 'default', secret = LINE_SECRET) {
    const body = JSON.stringify({
      destination: 'U0',
      events: [{ replyToken: `rt-${Math.random()}`, source: { type: 'user', userId }, timestamp: Date.now(), ...event }],
    });
    const res = await call(m.routes.lineChannelWebhook.POST, `/webhooks/line/${channelId}`, {
      method: 'POST',
      body,
      headers: { 'x-line-signature': lineSign(body, secret) },
      params: { channelId },
    });
    expect(res.status).toBe(200);
    await m.queue.drain();
  }
  let msgSeq = 0;
  const say = (userId: string, text: string) =>
    lineEvent(userId, { type: 'message', message: { id: `m${++msgSeq}`, type: 'text', text } });
  const sayTo = (channelId: string, secret: string, userId: string, text: string) =>
    lineEvent(userId, { type: 'message', message: { id: `m${++msgSeq}`, type: 'text', text } }, channelId, secret);
  const lastText = (stub: InstanceType<typeof m.line.StubLineClient>) =>
    stub.sent[stub.sent.length - 1].messages.map((msg: any) => msg.text ?? msg.altText).join('\n');
  async function loginAs(email: string, password: string) {
    const res = await call(m.routes.login.POST, '/api/auth/login', { method: 'POST', body: { email, password } });
    expect(res.status).toBe(201);
    return { authorization: `Bearer ${res.body.token}` };
  }
  const tap = (userId: string, data: string) => lineEvent(userId, { type: 'postback', postback: { data } });
  const lastTextTo = () => {
    const last = line.sent[line.sent.length - 1];
    return last.messages.map((msg: any) => msg.text ?? msg.altText).join('\n');
  };

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'ignore' });

    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(receiverStatus, { 'Content-Type': 'application/json' });
        res.end(receiverStatus === 200 ? JSON.stringify({ externalRef: `EXT-${received.length}` }) : 'boom');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, r));
    const port = (receiver.address() as AddressInfo).port;

    m = await load();
    prisma = m.db.prisma;
    line = lines.default = new m.line.StubLineClient('default');
    m.line.setLineClientFactory((channelId) => (lines[channelId] ??= new m.line.StubLineClient(channelId)));
    m.worker.registerHandlers();

    await prisma.$executeRawUnsafe(
      'TRUNCATE "JobEvent","Job","Message","Conversation","Contact","Category","Integration","User","QueueTask","JobCounter","Setting","LineChannel" CASCADE',
    );
    await prisma.lineChannel.create({ data: { id: 'default', name: 'OA หลัก', channelSecret: LINE_SECRET } });
    const branch = await prisma.lineChannel.create({
      data: { name: 'OA สาขา', channelSecret: LINE_SECRET_B, greeting: 'ยินดีต้อนรับสู่ OA สาขา เลือกหัวข้อได้เลย' },
    });
    branchId = branch.id;
    const integration = await prisma.integration.create({
      data: { name: 'Downstream', endpointUrl: `http://127.0.0.1:${port}/jobs`, secret: INTEGRATION_SECRET },
    });
    integrationId = integration.id;
    await prisma.category.create({
      data: {
        code: 'repair',
        name: 'แจ้งซ่อม',
        autoCreateJob: true,
        integrationId,
        form: [
          { key: 'location', label: 'สถานที่', required: true },
          { key: 'detail', label: 'รายละเอียด', required: true },
          { key: 'phone', label: 'เบอร์โทร', required: false },
        ],
      },
    });
    await prisma.user.create({
      data: {
        email: 'agent@test.local',
        name: 'Agent One',
        passwordHash: await m.bcrypt.hash('agent-pass-1', 4),
        channels: { connect: { id: 'default' } },
      },
    });
    auth = await loginAs('agent@test.local', 'agent-pass-1');
  });

  afterAll(async () => {
    m?.line.setLineClientFactory(null);
    await prisma?.$disconnect();
    receiver?.close();
  });

  it('rejects LINE webhooks with a bad signature or an unknown OA', async () => {
    const res = await call(m.routes.lineWebhook.POST, '/webhooks/line', {
      method: 'POST',
      body: { events: [] },
      headers: { 'x-line-signature': 'nope' },
    });
    expect(res.status).toBe(401);

    // Another OA's secret doesn't open this OA's webhook.
    const body = JSON.stringify({ events: [] });
    const wrongOa = await call(m.routes.lineChannelWebhook.POST, `/webhooks/line/${branchId}`, {
      method: 'POST',
      body,
      headers: { 'x-line-signature': lineSign(body, LINE_SECRET) },
      params: { channelId: branchId },
    });
    expect(wrongOa.status).toBe(401);
    const unknown = await call(m.routes.lineChannelWebhook.POST, '/webhooks/line/nope', {
      method: 'POST',
      body,
      headers: { 'x-line-signature': lineSign(body) },
      params: { channelId: 'nope' },
    });
    expect(unknown.status).toBe(404);
  });

  it('runs bot form → job → signed dispatch → callbacks → LINE status cards', async () => {
    const user = 'Ucustomer0001';
    await say(user, 'สวัสดี');
    expect(lastTextTo()).toContain('กรุณาเลือกหัวข้อ');

    await tap(user, 'action=cat&code=repair');
    expect(lastTextTo()).toContain('สถานที่');
    await say(user, 'อาคาร 1 ห้อง 101');
    await say(user, 'ไฟดับ');
    await tap(user, 'action=skip');
    expect(lastTextTo()).toContain('• รายละเอียด: ไฟดับ');
    await tap(user, 'action=confirm');

    const job = await prisma.job.findFirstOrThrow({ include: { contact: true } });
    expect(job.number).toMatch(/^JOB-\d{6}-0001$/);
    expect(job.status).toBe('SENT');
    expect(job.externalRef).toBe('EXT-1');
    expect(job.payload).toEqual({ location: 'อาคาร 1 ห้อง 101', detail: 'ไฟดับ', phone: '' });

    // Downstream received a correctly signed, idempotent request with a callback URL.
    expect(received).toHaveLength(1);
    const sent = JSON.parse(received[0].body);
    expect(received[0].headers['x-signature']).toBe(intSign(received[0].body));
    expect(received[0].headers['idempotency-key']).toBe(job.id);
    expect(sent.job.number).toBe(job.number);
    expect(sent.customer.lineUserId).toBe(user);
    expect(sent.channel).toEqual({ id: 'default', name: 'OA หลัก', basicId: null });
    expect(sent.callbackUrl).toBe(`https://cc.example.test/webhooks/jobs/${integrationId}/status`);

    // Customer got the job number, then a "sent" status card.
    const texts = line.sent.map((s: any) => s.messages.map((msg: any) => msg.text ?? msg.altText).join(' ')).join('\n');
    expect(texts).toContain(`เลขที่งาน: ${job.number}`);
    expect(line.sent[line.sent.length - 1].messages[0].type).toBe('flex');

    // Callbacks: bad signature, valid progress, invalid backwards move.
    const cb = (payload: object, sig?: string) => {
      const body = JSON.stringify(payload);
      return call(m.routes.jobCallback.POST, `/webhooks/jobs/${integrationId}/status`, {
        method: 'POST',
        body,
        headers: { 'x-signature': sig ?? intSign(body) },
        params: { integrationId },
      });
    };
    expect((await cb({ jobId: job.id, status: 'DONE' }, 'sha256=bad')).status).toBe(401);
    expect((await cb({ number: job.number, status: 'IN_PROGRESS', note: 'ช่างกำลังไป' })).status).toBe(200);
    await m.queue.drain();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('IN_PROGRESS');
    expect(lastTextTo()).toContain('อยู่ระหว่างดำเนินการ');
    expect((await cb({ jobId: job.id, status: 'ACCEPTED' })).status).toBe(409);
    expect((await cb({ jobId: job.id, status: 'DONE' })).status).toBe(200);
    await m.queue.drain();
    expect(lastTextTo()).toContain('เสร็จสิ้น');

    const events = await prisma.jobEvent.findMany({ where: { jobId: job.id }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.status)).toEqual(['DRAFT', 'SENT', 'IN_PROGRESS', 'DONE']);

    // Customer can track jobs by keyword.
    await say(user, 'ติดตามงาน');
    expect(lastTextTo()).toContain(job.number);
  });

  it('hands off to an agent who replies from the console and opens a job', async () => {
    const user = 'Ucustomer0002';
    await say(user, 'สวัสดี');
    await say(user, 'คุยกับเจ้าหน้าที่');

    const queueList = await call(m.routes.conversations.GET, '/api/conversations?view=queue', { headers: auth });
    expect(queueList.status).toBe(200);
    expect(queueList.body).toHaveLength(1);
    const conv = queueList.body[0];
    expect(conv.status).toBe('QUEUED');

    // Customer messages while queued are recorded but the bot stays quiet.
    const before = line.sent.length;
    await say(user, 'ไฟที่บ้านดับครับ');
    expect(line.sent.length).toBe(before);

    const reply = await call(m.routes.messages.POST, `/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: auth,
      body: { text: 'สวัสดีค่ะ รับเรื่องค่ะ' },
      params: { id: conv.id },
    });
    expect(reply.status).toBe(201);
    expect(line.sent[line.sent.length - 1]).toMatchObject({ kind: 'push', to: user });
    const detail = await call(m.routes.conversation.GET, `/api/conversations/${conv.id}`, { headers: auth, params: { id: conv.id } });
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('ASSIGNED');
    expect(detail.body.firstResponseAt).toBeTruthy();
    expect(detail.body.messages.map((msg: any) => msg.senderType)).toEqual(
      expect.arrayContaining(['CUSTOMER', 'BOT', 'SYSTEM', 'AGENT']),
    );

    // Sending it back to the queue after the first reply keeps the original queue time.
    const requeued = await call(m.routes.handoff.POST, `/api/conversations/${conv.id}/handoff`, {
      method: 'POST',
      headers: auth,
      params: { id: conv.id },
    });
    expect(requeued.status).toBe(201);
    expect(requeued.body.status).toBe('QUEUED');
    expect(requeued.body.queuedAt).toBe(detail.body.queuedAt);
    expect(new Date(requeued.body.firstResponseAt) >= new Date(requeued.body.queuedAt)).toBe(true);

    const created = await call(m.routes.jobs.POST, '/api/jobs', {
      method: 'POST',
      headers: auth,
      body: { contactId: conv.contactId, conversationId: conv.id, integrationId, title: 'ไฟดับที่บ้าน', priority: 'HIGH' },
    });
    expect(created.status).toBe(201);
    await m.queue.drain();
    const job = await prisma.job.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(job.status).toBe('SENT');
    expect(job.createdById).toBeTruthy();
  });

  it('retries a failing dispatch, marks it FAILED, and can resend', async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { lineUserId: 'Ucustomer0002' } });
    receiverStatus = 500;
    const created = await call(m.routes.jobs.POST, '/api/jobs', {
      method: 'POST',
      headers: auth,
      body: { contactId: contact.id, integrationId, title: 'ทดสอบส่งไม่สำเร็จ' },
    });
    expect(created.status).toBe(201);
    await m.queue.drain();
    let job = await prisma.job.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(job.status).toBe('FAILED');
    expect(job.lastError).toContain('HTTP 500');

    receiverStatus = 200;
    const resend = () =>
      call(m.routes.dispatch.POST, `/api/jobs/${job.id}/dispatch`, { method: 'POST', headers: auth, params: { id: job.id } });
    expect((await resend()).status).toBe(201);
    await m.queue.drain();
    job = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(job.status).toBe('SENT');
    expect((await resend()).status).toBe(409);
  });

  it('protects admin endpoints by role', async () => {
    expect((await call(m.routes.integrations.GET, '/api/integrations')).status).toBe(401);
    expect((await call(m.routes.integrations.GET, '/api/integrations', { headers: auth })).status).toBe(403);
  });

  it('leaves negative first-response rows out of the report', async () => {
    const before = await call(m.routes.report.GET, '/api/reports/summary?days=30', { headers: auth });
    expect(before.status).toBe(200);
    expect(before.body.handledConversations).toBeGreaterThan(0);
    expect(before.body.avgFirstResponseSeconds).toBeGreaterThanOrEqual(0);

    // A row written by the old handoff: re-queued an hour after the first reply.
    const contact = await prisma.contact.findFirstOrThrow({ where: { lineUserId: 'Ucustomer0002' } });
    const firstResponseAt = new Date(Date.now() - 2 * 3600_000);
    await prisma.conversation.create({
      data: {
        contactId: contact.id,
        channelId: contact.channelId,
        status: 'RESOLVED',
        firstResponseAt,
        queuedAt: new Date(firstResponseAt.getTime() + 3600_000),
      },
    });

    const after = await call(m.routes.report.GET, '/api/reports/summary?days=30', { headers: auth });
    expect(after.body.handledConversations).toBe(before.body.handledConversations);
    expect(after.body.avgFirstResponseSeconds).toBe(before.body.avgFirstResponseSeconds);
  });

  it('validates request bodies', async () => {
    const res = await call(m.routes.jobs.POST, '/api/jobs', { method: 'POST', headers: auth, body: { title: '' } });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  describe('multiple LINE OAs', () => {
    const shared = 'Ushared0001';

    it('keeps each OA separate: own contact, own LINE client, own bot texts', async () => {
      await say(shared, 'สวัสดี');
      await sayTo(branchId, LINE_SECRET_B, shared, 'สวัสดี');

      // Same LINE user id in two OAs → two contacts, one per OA.
      const contacts = await prisma.contact.findMany({ where: { lineUserId: shared } });
      expect(contacts.map((c) => c.channelId).sort()).toEqual(['default', branchId].sort());
      const convs = await prisma.conversation.findMany({ where: { contact: { lineUserId: shared } } });
      for (const conv of convs) expect(conv.channelId).toBe(contacts.find((c) => c.id === conv.contactId)!.channelId);

      // Replies went out through each OA's own client; the branch OA uses its greeting override.
      expect(lastText(lines.default)).toContain('กรุณาเลือกหัวข้อ');
      expect(lastText(lines[branchId])).toContain('ยินดีต้อนรับสู่ OA สาขา');
    });

    it('routes the legacy webhook URL to the default OA and drops events of a disabled OA', async () => {
      const body = JSON.stringify({
        events: [{ type: 'follow', replyToken: 'rt-legacy', source: { type: 'user', userId: 'Ulegacy0001' } }],
      });
      const res = await call(m.routes.lineWebhook.POST, '/webhooks/line', {
        method: 'POST',
        body,
        headers: { 'x-line-signature': lineSign(body) },
      });
      expect(res.status).toBe(200);
      await m.queue.drain();
      expect((await prisma.contact.findFirstOrThrow({ where: { lineUserId: 'Ulegacy0001' } })).channelId).toBe('default');

      await prisma.lineChannel.update({ where: { id: branchId }, data: { isActive: false } });
      await sayTo(branchId, LINE_SECRET_B, 'Uignored0001', 'สวัสดี');
      expect(await prisma.contact.count({ where: { lineUserId: 'Uignored0001' } })).toBe(0);
      await prisma.lineChannel.update({ where: { id: branchId }, data: { isActive: true } });
    });

    it('shows agents only the OAs they are assigned to', async () => {
      await sayTo(branchId, LINE_SECRET_B, 'Ubranch0001', 'คุยกับเจ้าหน้าที่');
      const branchConv = await prisma.conversation.findFirstOrThrow({
        where: { channelId: branchId, contact: { lineUserId: 'Ubranch0001' } },
      });
      expect(branchConv.status).toBe('QUEUED');

      // Agent One handles the default OA only.
      const all = await call(m.routes.conversations.GET, '/api/conversations?view=all', { headers: auth });
      expect(all.body.length).toBeGreaterThan(0);
      expect(all.body.every((c: any) => c.channelId === 'default')).toBe(true);
      const filtered = await call(m.routes.conversations.GET, `/api/conversations?view=all&channelId=${branchId}`, { headers: auth });
      expect(filtered.body).toEqual([]);
      const counts = await call(m.routes.counts.GET, '/api/conversations/counts', { headers: auth });
      expect(counts.body.queue).toBe(await prisma.conversation.count({ where: { channelId: 'default', status: 'QUEUED' } }));

      const params = { id: branchConv.id };
      expect((await call(m.routes.conversation.GET, `/api/conversations/${branchConv.id}`, { headers: auth, params })).status).toBe(404);
      const reply = await call(m.routes.messages.POST, `/api/conversations/${branchConv.id}/messages`, {
        method: 'POST',
        headers: auth,
        body: { text: 'แอบตอบ' },
        params,
      });
      expect(reply.status).toBe(404);
      const contactParams = { id: branchConv.contactId };
      expect((await call(m.routes.contact.GET, '/api/contacts/x', { headers: auth, params: contactParams })).status).toBe(404);
      const job = await call(m.routes.jobs.POST, '/api/jobs', {
        method: 'POST',
        headers: auth,
        body: { contactId: branchConv.contactId, title: 'ไม่ควรสร้างได้' },
      });
      expect(job.status).toBe(404);
      const options = await call(m.routes.lineChannelOptions.GET, '/api/line-channels/options', { headers: auth });
      expect(options.body.map((c: any) => c.id)).toEqual(['default']);

      // Admins see every OA but can't hand a chat to an agent outside its OA.
      await prisma.user.create({
        data: { email: 'admin@test.local', name: 'Admin', role: 'ADMIN', passwordHash: await m.bcrypt.hash('admin-pass-1', 4) },
      });
      const admin = await loginAs('admin@test.local', 'admin-pass-1');
      const adminView = await call(m.routes.conversation.GET, `/api/conversations/${branchConv.id}`, { headers: admin, params });
      expect(adminView.status).toBe(200);
      expect(adminView.body.channel.name).toBe('OA สาขา');
      const agent = await prisma.user.findUniqueOrThrow({ where: { email: 'agent@test.local' } });
      const assign = await call(m.routes.assign.POST, `/api/conversations/${branchConv.id}/assign`, {
        method: 'POST',
        headers: admin,
        body: { userId: agent.id },
        params,
      });
      expect(assign.status).toBe(400);

      // Admin channel list never exposes credentials.
      const channels = await call(m.routes.lineChannels.GET, '/api/line-channels', { headers: admin });
      expect(channels.body).toHaveLength(2);
      expect(channels.body[0]).not.toHaveProperty('channelSecret');
      expect(channels.body[0]).toMatchObject({ hasSecret: true, webhookUrl: 'https://cc.example.test/webhooks/line/default' });
      expect((await call(m.routes.lineChannels.GET, '/api/line-channels', { headers: auth })).status).toBe(403);
    });

    it('copies the legacy env credentials into the default OA once', async () => {
      await prisma.lineChannel.update({ where: { id: 'default' }, data: { channelSecret: null, accessToken: 'keep-me' } });
      process.env.LINE_CHANNEL_SECRET = 'from-env';
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'env-token';
      try {
        await m.channels.importEnvCredentials();
      } finally {
        process.env.LINE_CHANNEL_SECRET = '';
        process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
      }
      const channel = await prisma.lineChannel.findUniqueOrThrow({ where: { id: 'default' } });
      expect(channel.channelSecret).toBe('from-env');
      expect(channel.accessToken).toBe('keep-me');
      await prisma.lineChannel.update({ where: { id: 'default' }, data: { channelSecret: LINE_SECRET, accessToken: null } });
    });
  });

  describe('Auth0 login', () => {
    const AUTH0_ENV = { AUTH0_DOMAIN: 'tenant.example.test', AUTH0_CLIENT_ID: 'client-1', AUTH0_CLIENT_SECRET: 'secret-1' };
    const withAuth0 = async <T>(fn: () => Promise<T>) => {
      Object.assign(process.env, AUTH0_ENV);
      try {
        return await fn();
      } finally {
        for (const k of Object.keys(AUTH0_ENV)) delete process.env[k];
      }
    };

    it('matches only accounts an admin created, linking them by verified email', async () => {
      const resolve = m.auth0.resolveAuth0User;
      const created = await prisma.user.create({ data: { email: 'sso@test.local', name: 'SSO Agent' } });

      expect(await resolve({ sub: 'auth0|x', email: 'nobody@test.local', email_verified: true })).toEqual({ error: 'not_registered' });
      expect(await resolve({ sub: 'auth0|1', email: 'SSO@test.local', email_verified: false })).toEqual({ error: 'email_unverified' });
      expect(await resolve({ sub: 'auth0|1' })).toEqual({ error: 'not_registered' });

      const first = await resolve({ sub: 'auth0|1', email: 'SSO@test.local', email_verified: true });
      expect(first).toMatchObject({ user: { id: created.id } });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).auth0Sub).toBe('auth0|1');

      // Later logins go by the linked Auth0 id, even if the Auth0 email changed.
      expect(await resolve({ sub: 'auth0|1', email: 'renamed@test.local', email_verified: true })).toMatchObject({ user: { id: created.id } });
      // An account already linked to one Auth0 identity can't be claimed by another with the same email.
      expect(await resolve({ sub: 'google|2', email: 'sso@test.local', email_verified: true })).toEqual({ error: 'not_registered' });

      await prisma.user.update({ where: { id: created.id }, data: { isActive: false } });
      expect(await resolve({ sub: 'auth0|1', email: 'sso@test.local', email_verified: true })).toEqual({ error: 'not_registered' });
    });

    it('creates Auth0-only users without a password, who cannot use password login', async () => {
      // The admin created in the multi-OA tests.
      const admin = await loginAs('admin@test.local', 'admin-pass-1');
      const res = await call(m.routes.users.POST, '/api/users', {
        method: 'POST',
        headers: admin,
        body: { email: 'nopass@test.local', name: 'No Password' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: 'nopass@test.local', auth0Linked: false });
      expect(res.body).not.toHaveProperty('auth0Sub');

      const login = await call(m.routes.login.POST, '/api/auth/login', {
        method: 'POST',
        body: { email: 'nopass@test.local', password: 'anything-1' },
      });
      expect(login.status).toBe(401);
    });

    it('offers Auth0 only when configured, and rejects a callback with a mismatched state', async () => {
      expect((await call(m.routes.providers.GET, '/api/auth/providers')).body).toEqual({ auth0: false });
      expect((await call(m.routes.auth0Login.GET, '/api/auth/auth0/login')).status).toBe(404);

      await withAuth0(async () => {
        expect((await call(m.routes.providers.GET, '/api/auth/providers')).body).toEqual({ auth0: true });

        const start = await m.routes.auth0Login.GET(new Request('http://test.local/api/auth/auth0/login'), { params: Promise.resolve({}) });
        expect(start.status).toBe(302);
        const authorize = new URL(start.headers.get('location')!);
        expect(authorize.origin + authorize.pathname).toBe('https://tenant.example.test/authorize');
        expect(authorize.searchParams.get('redirect_uri')).toBe('https://cc.example.test/api/auth/auth0/callback');
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        const cookie = start.headers.get('set-cookie')!;
        expect(cookie).toMatch(/^cc\.auth0=.+HttpOnly.+Secure$/);

        const callback = await m.routes.auth0Callback.GET(
          new Request('http://test.local/api/auth/auth0/callback?code=abc&state=forged', {
            headers: { cookie: cookie.split(';')[0] },
          }),
        );
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toBe('https://cc.example.test/login?error=auth0_failed');
        expect(callback.headers.get('set-cookie')).toMatch(/Max-Age=0/);
      });
    });
  });
});
