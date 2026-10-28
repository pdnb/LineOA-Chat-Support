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
  sla: await import('@/server/sla'),
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
    transfer: await import('@/app/api/conversations/[id]/transfer/route'),
    reopen: await import('@/app/api/conversations/[id]/reopen/route'),
    resolve: await import('@/app/api/conversations/[id]/resolve/route'),
    stickers: await import('@/app/api/conversations/[id]/stickers/route'),
    attachments: await import('@/app/api/conversations/[id]/attachments/route'),
    contactTags: await import('@/app/api/contacts/tags/route'),
    canned: await import('@/app/api/canned-replies/route'),
    settings: await import('@/app/api/settings/route'),
    settingKey: await import('@/app/api/settings/[key]/route'),
    queueTasks: await import('@/app/api/queue-tasks/route'),
    queueTask: await import('@/app/api/queue-tasks/[id]/route'),
    queueRetry: await import('@/app/api/queue-tasks/[id]/retry/route'),
    queuePurge: await import('@/app/api/queue-tasks/purge/route'),
    auditLogs: await import('@/app/api/audit-logs/route'),
    reportAgents: await import('@/app/api/reports/agents/route'),
    reportExport: await import('@/app/api/reports/export/route'),
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
      'TRUNCATE "JobEvent","Job","Message","Conversation","Contact","Category","Integration","User","QueueTask","JobCounter","Setting","LineChannel","CannedReply","AuditLog" CASCADE',
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

    it('queues chats straight for an agent when the OA has the bot switched off', async () => {
      await prisma.lineChannel.update({ where: { id: branchId }, data: { botEnabled: false } });
      const sentBefore = lines[branchId].sent.length;

      // A follow alone opens nothing; the first message goes to the queue with no auto reply.
      await lineEvent('Unobot0001', { type: 'follow' }, branchId, LINE_SECRET_B);
      expect(await prisma.conversation.count({ where: { contact: { lineUserId: 'Unobot0001' } } })).toBe(0);
      await sayTo(branchId, LINE_SECRET_B, 'Unobot0001', 'สวัสดี');
      const conv = await prisma.conversation.findFirstOrThrow({
        where: { channelId: branchId, contact: { lineUserId: 'Unobot0001' } },
        include: { messages: true },
      });
      expect(conv.status).toBe('QUEUED');
      expect(conv.messages.some((msg) => msg.senderType === 'BOT')).toBe(false);
      expect(conv.messages.some((msg) => msg.senderType === 'SYSTEM')).toBe(true);

      // Job tracking is part of the bot, so it stays quiet too.
      await sayTo(branchId, LINE_SECRET_B, 'Unobot0001', 'ติดตามงาน');
      expect(lines[branchId].sent.length).toBe(sentBefore);

      await prisma.lineChannel.update({ where: { id: branchId }, data: { botEnabled: true } });
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

  describe('support features', () => {
    let admin: Record<string, string>;
    let agent1Id: string;
    let agent2Id: string;
    let agent2: Record<string, string>;
    let branchAgent: Record<string, string>;
    let branchAgentId: string;

    /** Multipart request (FormData sets its own content type). */
    async function callForm(handler: Handler, path: string, form: FormData, headers: Record<string, string>, params: Record<string, string>) {
      const res = await handler(new Request(`http://test.local${path}`, { method: 'POST', headers, body: form }), {
        params: Promise.resolve(params),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    }
    const post = (handler: Handler, path: string, headers: Record<string, string>, params: Record<string, string>, body: unknown = {}) =>
      call(handler, path, { method: 'POST', headers, body, params });
    /** A customer who asked for an agent; returns their queued conversation. */
    async function queuedChat(userId: string) {
      await say(userId, 'คุยกับเจ้าหน้าที่');
      return prisma.conversation.findFirstOrThrow({
        where: { contact: { lineUserId: userId, channelId: 'default' }, status: 'QUEUED' },
      });
    }
    const reply = (convId: string, headers: Record<string, string>, text = 'สวัสดีค่ะ') =>
      post(m.routes.messages.POST, `/api/conversations/${convId}/messages`, headers, { id: convId }, { text });

    beforeAll(async () => {
      const hash = await m.bcrypt.hash('pass-1234', 4);
      agent1Id = (await prisma.user.findUniqueOrThrow({ where: { email: 'agent@test.local' } })).id;
      await prisma.user.upsert({
        where: { email: 'admin@test.local' },
        create: { email: 'admin@test.local', name: 'Admin', role: 'ADMIN', passwordHash: await m.bcrypt.hash('admin-pass-1', 4) },
        update: {},
      });
      agent2Id = (
        await prisma.user.create({
          data: { email: 'agent2@test.local', name: 'Agent Two', passwordHash: hash, channels: { connect: { id: 'default' } } },
        })
      ).id;
      branchAgentId = (
        await prisma.user.create({
          data: { email: 'branch@test.local', name: 'Branch Agent', passwordHash: hash, channels: { connect: { id: branchId } } },
        })
      ).id;
      admin = await loginAs('admin@test.local', 'admin-pass-1');
      agent2 = await loginAs('agent2@test.local', 'pass-1234');
      branchAgent = await loginAs('branch@test.local', 'pass-1234');
    });

    it('transfers a chat between agents of the OA, with a note', async () => {
      const conv = await queuedChat('Utransfer0001');
      expect((await reply(conv.id, auth)).status).toBe(201);
      const path = `/api/conversations/${conv.id}/transfer`;
      const params = { id: conv.id };

      const moved = await post(m.routes.transfer.POST, path, auth, params, { userId: agent2Id, note: 'ลูกค้า VIP' });
      expect(moved.status).toBe(201);
      expect(moved.body.assignedToId).toBe(agent2Id);
      const note = await prisma.message.findFirst({ where: { conversationId: conv.id, senderType: 'SYSTEM', text: { contains: 'ลูกค้า VIP' } } });
      expect(note?.text).toContain('Agent Two');

      // Agent One no longer owns it; Agent Two can't hand it to someone outside the OA.
      expect((await post(m.routes.transfer.POST, path, auth, params, { userId: agent1Id })).status).toBe(403);
      expect((await post(m.routes.transfer.POST, path, agent2, params, { userId: branchAgentId })).status).toBe(400);
      expect((await post(m.routes.transfer.POST, path, agent2, params, { userId: agent1Id })).status).toBe(201);
      expect(await prisma.auditLog.count({ where: { action: 'conversation.transfer', entityId: conv.id } })).toBe(2);
    });

    it('filters chats by contact tag, with tags scoped to the agent’s OAs', async () => {
      const conv = await queuedChat('Utagged0001');
      const patched = await call(m.routes.contact.PATCH, `/api/contacts/${conv.contactId}`, {
        method: 'PATCH',
        headers: auth,
        body: { tags: ['vip'] },
        params: { id: conv.contactId },
      });
      expect(patched.status).toBe(200);
      const list = await call(m.routes.conversations.GET, '/api/conversations?view=all&tag=vip', { headers: auth });
      expect(list.body.map((c: any) => c.id)).toEqual([conv.id]);
      expect((await call(m.routes.contactTags.GET, '/api/contacts/tags', { headers: auth })).body).toContain('vip');
      expect((await call(m.routes.contactTags.GET, '/api/contacts/tags', { headers: branchAgent })).body).not.toContain('vip');
    });

    it('reopens a resolved chat into the same conversation, unless a newer one is open', async () => {
      const user = 'Ureopen0001';
      const conv = await queuedChat(user);
      await reply(conv.id, auth);
      const params = { id: conv.id };
      expect((await post(m.routes.resolve.POST, `/api/conversations/${conv.id}/resolve`, auth, params)).status).toBe(201);

      const reopened = await post(m.routes.reopen.POST, `/api/conversations/${conv.id}/reopen`, agent2, params);
      expect(reopened.status).toBe(201);
      expect(reopened.body).toMatchObject({ status: 'ASSIGNED', assignedToId: agent2Id, resolvedAt: null });
      await say(user, 'ขอบคุณที่เปิดเรื่องให้ครับ');
      expect(await prisma.conversation.count({ where: { contact: { lineUserId: user } } })).toBe(1);

      // Closed again, then the customer writes: a new chat opens and the old one can't be reopened.
      await post(m.routes.resolve.POST, `/api/conversations/${conv.id}/resolve`, agent2, params);
      await say(user, 'มีเรื่องใหม่ครับ');
      expect(await prisma.conversation.count({ where: { contact: { lineUserId: user } } })).toBe(2);
      expect((await post(m.routes.reopen.POST, `/api/conversations/${conv.id}/reopen`, agent2, params)).status).toBe(409);
    });

    it('serves canned replies per OA scope; only admins manage them', async () => {
      const create = (headers: Record<string, string>, body: object) => post(m.routes.canned.POST, '/api/canned-replies', headers, {}, body);
      expect((await create(admin, { shortcut: 'Hi', text: 'สวัสดีคุณ {name}' })).status).toBe(201);
      expect((await create(admin, { shortcut: 'br', text: 'เฉพาะสาขา', channelId: branchId })).status).toBe(201);
      expect((await create(admin, { shortcut: 'hi', text: 'ซ้ำ' })).status).toBe(409);
      // The same shortcut in another scope is fine.
      expect((await create(admin, { shortcut: 'hi', text: 'สาขา', channelId: branchId })).status).toBe(201);
      expect((await create(auth, { shortcut: 'x', text: 'x' })).status).toBe(403);

      const mine = await call(m.routes.canned.GET, '/api/canned-replies', { headers: auth });
      const shortcuts = mine.body.map((r: any) => `${r.shortcut}:${r.channelId ?? '*'}`);
      expect(shortcuts).toContain('hi:*');
      expect(shortcuts.some((s: string) => s.endsWith(branchId))).toBe(false);
      const settings = await call(m.routes.settings.GET, '/api/settings', { headers: auth });
      expect(settings.body).not.toHaveProperty('canned.replies');
    });

    it('sends stickers and files, and pages through long histories', async () => {
      const conv = await queuedChat('Umedia0001');
      const params = { id: conv.id };
      const sticker = (body: object) => post(m.routes.stickers.POST, `/api/conversations/${conv.id}/stickers`, auth, params, body);
      expect((await sticker({ packageId: 446, stickerId: 1988 })).status).toBe(201);
      expect(line.sent[line.sent.length - 1].messages[0]).toMatchObject({ type: 'sticker', packageId: '446', stickerId: '1988' });
      expect((await sticker({ packageId: 446, stickerId: 99 })).status).toBe(400);

      const pdf = new FormData();
      pdf.append('file', new File([new Uint8Array([37, 80, 68, 70])], 'ใบเสนอราคา.pdf', { type: 'application/pdf' }));
      const sent = await callForm(m.routes.attachments.POST, `/api/conversations/${conv.id}/attachments`, pdf, auth, params);
      expect(sent.status).toBe(201);
      expect(sent.body[0]).toMatchObject({ type: 'file', text: 'ใบเสนอราคา.pdf', payload: { sentAs: 'link' } });
      expect(lastTextTo()).toMatch(/ใบเสนอราคา\.pdf[\s\S]*https:\/\/cc\.example\.test\/media\/[0-9a-f-]{36}\.pdf/);
      const html = new FormData();
      html.append('file', new File(['<script>'], 'x.html', { type: 'text/html' }));
      expect((await callForm(m.routes.attachments.POST, `/api/conversations/${conv.id}/attachments`, html, auth, params)).status).toBe(400);

      // 120 old messages on a fresh chat: newest 50 first, then pages of older ones without overlap.
      const contact = await prisma.contact.findFirstOrThrow({ where: { lineUserId: 'Umedia0001' } });
      const long = await prisma.conversation.create({ data: { contactId: contact.id, channelId: 'default', status: 'RESOLVED' } });
      const t0 = Date.now() - 3600_000;
      await prisma.message.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          conversationId: long.id,
          direction: 'IN' as const,
          senderType: 'CUSTOMER' as const,
          type: 'text',
          text: `m${i}`,
          createdAt: new Date(t0 + i * 1000),
        })),
      });
      const lp = { id: long.id };
      const first = await call(m.routes.conversation.GET, `/api/conversations/${long.id}`, { headers: auth, params: lp });
      expect(first.body.messages.map((x: any) => x.text)).toEqual(Array.from({ length: 50 }, (_, i) => `m${70 + i}`));
      expect(first.body.hasMoreMessages).toBe(true);
      const page = (before: string) =>
        call(m.routes.messages.GET, `/api/conversations/${long.id}/messages?before=${before}`, { headers: auth, params: lp });
      const second = await page(first.body.messages[0].id);
      expect(second.body.messages.map((x: any) => x.text)).toEqual(Array.from({ length: 50 }, (_, i) => `m${20 + i}`));
      expect(second.body.hasMore).toBe(true);
      const third = await page(second.body.messages[0].id);
      expect(third.body.messages).toHaveLength(20);
      expect(third.body.hasMore).toBe(false);
    });

    it('asks for a rating after resolve and records the first tap only', async () => {
      await prisma.lineChannel.update({ where: { id: 'default' }, data: { csatEnabled: true } });
      const user = 'Ucsat0001';
      const conv = await queuedChat(user);
      await reply(conv.id, auth);
      await post(m.routes.resolve.POST, `/api/conversations/${conv.id}/resolve`, auth, { id: conv.id });
      await m.queue.drain();
      const card = line.sent[line.sent.length - 1];
      expect(card).toMatchObject({ kind: 'push', to: user });
      expect(card.messages[0].type).toBe('flex');
      expect(JSON.stringify(card.messages[0])).toContain(`action=csat&c=${conv.id}&r=5`);

      await tap(user, `action=csat&c=${conv.id}&r=5`);
      expect(lastTextTo()).toContain('ขอบคุณสำหรับคะแนน');
      await tap(user, `action=csat&c=${conv.id}&r=1`);
      const rated = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
      expect(rated.csatRating).toBe(5);
      // Tapping the card doesn't open a new chat.
      expect(await prisma.conversation.count({ where: { contact: { lineUserId: user } } })).toBe(1);

      // Someone else's card id is ignored.
      await say('Ucsat0002', 'สวัสดี');
      await tap('Ucsat0002', `action=csat&c=${conv.id}&r=1`);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).csatRating).toBe(5);

      // A chat no agent answered gets no card.
      const botOnly = await prisma.conversation.findFirstOrThrow({ where: { contact: { lineUserId: 'Ucsat0002' } } });
      await post(m.routes.resolve.POST, `/api/conversations/${botOnly.id}/resolve`, auth, { id: botOnly.id });
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: botOnly.id } })).csatSentAt).toBeNull();

      const report = await call(m.routes.report.GET, '/api/reports/summary?days=30', { headers: auth });
      expect(report.body.csat).toMatchObject({ avg: 5, rated: 1, sent: 1 });
      await prisma.lineChannel.update({ where: { id: 'default' }, data: { csatEnabled: false } });
    });

    it('alerts once per wait when a chat breaches its SLA', async () => {
      const put = (value: object) =>
        call(m.routes.settingKey.PUT, '/api/settings/sla', { method: 'PUT', headers: admin, body: { value }, params: { key: 'sla' } });
      expect((await put({ enabled: true, queueWaitMinutes: 0, firstResponseMinutes: 10 })).status).toBe(400);
      expect((await put({ enabled: true, queueWaitMinutes: 1, firstResponseMinutes: 10 })).status).toBe(200);

      const conv = await queuedChat('Usla0001');
      // Just queued: within the limit, whatever the database session's time zone is.
      expect((await m.sla.checkSla()).some((b) => b.id === conv.id)).toBe(false);
      await prisma.conversation.update({ where: { id: conv.id }, data: { waitingSince: new Date(Date.now() - 2 * 60_000) } });
      expect((await m.sla.checkSla()).find((b) => b.id === conv.id)?.kind).toBe('queue');
      expect((await m.sla.checkSla()).some((b) => b.id === conv.id)).toBe(false);

      // Taking the chat starts a new clock: the first answer.
      await post(m.routes.assign.POST, `/api/conversations/${conv.id}/assign`, auth, { id: conv.id });
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).slaAlertedAt).toBeNull();
      await prisma.conversation.update({ where: { id: conv.id }, data: { queuedAt: new Date(Date.now() - 20 * 60_000) } });
      expect((await m.sla.checkSla()).find((b) => b.id === conv.id)?.kind).toBe('response');
      await put({ enabled: true, queueWaitMinutes: 5, firstResponseMinutes: 10 });
    });

    it('reports per agent and exports CSV for admins only', async () => {
      const mine = await call(m.routes.reportAgents.GET, '/api/reports/agents?days=30', { headers: auth });
      expect(mine.body.agents).toHaveLength(1);
      expect(mine.body.agents[0]).toMatchObject({ userId: agent1Id });
      expect(mine.body.agents[0].handled).toBeGreaterThan(0);
      expect(mine.body.agents[0].csatAvg).toBe(5);

      const all = await call(m.routes.reportAgents.GET, '/api/reports/agents?days=30', { headers: admin });
      expect(all.body.agents.map((a: any) => a.userId)).toEqual(expect.arrayContaining([agent1Id, agent2Id]));

      const csv = await m.routes.reportExport.GET(new Request('http://test.local/api/reports/export?type=conversations&days=30', { headers: admin }), {
        params: Promise.resolve({}),
      });
      expect(csv.status).toBe(200);
      expect(csv.headers.get('content-type')).toContain('text/csv');
      // text() would drop the BOM while decoding; the downloaded bytes keep it for Excel.
      const bytes = Buffer.from(await csv.arrayBuffer());
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = bytes.toString('utf8');
      expect(text.startsWith('﻿id,LINE OA,ลูกค้า')).toBe(true);
      expect(text).toContain('OA หลัก');
      const forbidden = await call(m.routes.reportExport.GET, '/api/reports/export?type=jobs', { headers: auth });
      expect(forbidden.status).toBe(403);
    });

    it('waits for a delayed queue task, whatever the database session’s time zone is', async () => {
      const task = await m.queue.enqueue('line-push', { contactId: 'nobody', messages: [] }, { delayMs: 60_000 });
      await m.queue.drain();
      expect(await prisma.queueTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'PENDING', attempts: 0 });
      await prisma.queueTask.delete({ where: { id: task.id } });
    });

    it('lets admins inspect, retry, delete and purge queue tasks, with an audit trail', async () => {
      expect((await call(m.routes.queueTasks.GET, '/api/queue-tasks?status=FAILED', { headers: auth })).status).toBe(403);
      const failed = await call(m.routes.queueTasks.GET, '/api/queue-tasks?status=FAILED', { headers: admin });
      expect(failed.status).toBe(200);
      const task = failed.body.items.find((t: any) => t.queue === 'job-dispatch');
      expect(task).toBeTruthy();
      expect(failed.body.stats.some((s: any) => s.status === 'FAILED' && s.count > 0)).toBe(true);

      const tp = { id: task.id };
      expect((await post(m.routes.queueRetry.POST, `/api/queue-tasks/${task.id}/retry`, admin, tp)).status).toBe(201);
      expect(await prisma.queueTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'PENDING', attempts: 0 });
      expect((await post(m.routes.queueRetry.POST, `/api/queue-tasks/${task.id}/retry`, admin, tp)).status).toBe(409);
      expect((await call(m.routes.queueTask.DELETE, `/api/queue-tasks/${task.id}`, { method: 'DELETE', headers: admin, params: tp })).status).toBe(409);
      await m.queue.drain();
      // The job was resent earlier, so the retried dispatch has nothing left to do.
      expect((await prisma.queueTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('DONE');
      expect((await call(m.routes.queueTask.DELETE, `/api/queue-tasks/${task.id}`, { method: 'DELETE', headers: admin, params: tp })).status).toBe(200);

      const purged = await post(m.routes.queuePurge.POST, '/api/queue-tasks/purge', admin, {}, { olderThanDays: 0 });
      expect(purged.body.count).toBeGreaterThan(0);
      expect(await prisma.queueTask.count({ where: { status: 'DONE' } })).toBe(0);

      const logs = await call(m.routes.auditLogs.GET, '/api/audit-logs?action=queue.', { headers: admin });
      expect(logs.body.items.map((l: any) => l.action)).toEqual(expect.arrayContaining(['queue.retry', 'queue.delete', 'queue.purge']));
      expect(logs.body.items[0].actor.name).toBe('Admin');
    });
  });
});
