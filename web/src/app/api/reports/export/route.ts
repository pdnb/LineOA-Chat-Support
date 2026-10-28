import { z } from 'zod';
import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { CsvColumn, csvResponse, toCsv } from '@/server/csv';
import { prisma } from '@/server/db';
import { route, searchParams } from '@/server/http';
import { AgentStats, agentStats, reportWindow } from '@/server/reports';

const Query = z.object({ type: z.enum(['conversations', 'jobs', 'agents']), days: z.string().optional() });
const MAX_ROWS = 50_000;

const seconds = (from: Date | null, to: Date | null) =>
  from && to && to >= from ? Math.round((to.getTime() - from.getTime()) / 1000) : null;

/** CSV download of the report period. Admin only: it contains customer names and phone numbers. */
export const GET = route(async (req) => {
  const user = await requireUser(req, 'ADMIN');
  const { type, days: daysParam } = Query.parse(Object.fromEntries(searchParams(req)));
  const { days, since } = reportWindow(daysParam);
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(new Date());
  await audit(user, 'report.export', { type: 'report', id: type }, { days });

  if (type === 'conversations') {
    const rows = await prisma.conversation.findMany({
      where: { createdAt: { gte: since } },
      include: {
        contact: true,
        channel: { select: { name: true } },
        category: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    const names = new Map(
      (await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name] as const),
    );
    type Row = (typeof rows)[number];
    const columns: CsvColumn<Row>[] = [
      { header: 'id', value: (r) => r.id },
      { header: 'LINE OA', value: (r) => r.channel.name },
      { header: 'ลูกค้า', value: (r) => r.contact.displayName },
      { header: 'เบอร์โทร', value: (r) => r.contact.phone },
      { header: 'แท็ก', value: (r) => r.contact.tags.join(', ') },
      { header: 'สถานะ', value: (r) => r.status },
      { header: 'หมวด', value: (r) => r.category?.name },
      { header: 'ผู้ดูแล', value: (r) => r.assignedTo?.name },
      { header: 'ผู้ตอบคนแรก', value: (r) => (r.firstResponderId ? names.get(r.firstResponderId) : null) },
      { header: 'ผู้ปิดเรื่อง', value: (r) => (r.resolvedById ? names.get(r.resolvedById) : null) },
      { header: 'เริ่มแชต', value: (r) => r.createdAt },
      { header: 'เข้าคิว', value: (r) => r.queuedAt },
      { header: 'ตอบครั้งแรก', value: (r) => r.firstResponseAt },
      { header: 'ปิดเรื่อง', value: (r) => r.resolvedAt },
      { header: 'เวลาตอบครั้งแรก (วินาที)', value: (r) => seconds(r.queuedAt, r.firstResponseAt) },
      { header: 'เวลาจนปิดเรื่อง (วินาที)', value: (r) => seconds(r.queuedAt ?? r.createdAt, r.resolvedAt) },
      { header: 'คะแนนความพึงพอใจ', value: (r) => r.csatRating },
    ];
    return csvResponse(toCsv(columns, rows), `conversations-${days}d-${stamp}.csv`);
  }

  if (type === 'jobs') {
    const rows = await prisma.job.findMany({
      where: { createdAt: { gte: since } },
      include: {
        contact: { select: { displayName: true, phone: true } },
        category: { select: { name: true } },
        integration: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    type Row = (typeof rows)[number];
    const columns: CsvColumn<Row>[] = [
      { header: 'เลขที่', value: (r) => r.number },
      { header: 'เรื่อง', value: (r) => r.title },
      { header: 'หมวด', value: (r) => r.category?.name },
      { header: 'สถานะ', value: (r) => r.status },
      { header: 'ความเร่งด่วน', value: (r) => r.priority },
      { header: 'ระบบปลายทาง', value: (r) => r.integration?.name },
      { header: 'ลูกค้า', value: (r) => r.contact.displayName },
      { header: 'เบอร์โทร', value: (r) => r.contact.phone },
      { header: 'สร้างโดย', value: (r) => r.createdBy?.name ?? 'Bot' },
      { header: 'สร้างเมื่อ', value: (r) => r.createdAt },
      { header: 'อัปเดตล่าสุด', value: (r) => r.updatedAt },
      { header: 'เลขอ้างอิงปลายทาง', value: (r) => r.externalRef },
    ];
    return csvResponse(toCsv(columns, rows), `jobs-${days}d-${stamp}.csv`);
  }

  const { agents } = await agentStats(daysParam, null);
  const round = (n: number | null) => (n == null ? null : Math.round(n));
  const columns: CsvColumn<AgentStats>[] = [
    { header: 'เจ้าหน้าที่', value: (r) => r.name },
    { header: 'แชตที่ดูแล', value: (r) => r.handled },
    { header: 'ข้อความที่ส่ง', value: (r) => r.messagesSent },
    { header: 'ปิดเรื่อง', value: (r) => r.resolved },
    { header: 'เวลาตอบครั้งแรกเฉลี่ย (วินาที)', value: (r) => round(r.avgFirstResponseSeconds) },
    { header: 'เวลาจนปิดเรื่องเฉลี่ย (วินาที)', value: (r) => round(r.avgResolutionSeconds) },
    { header: 'คะแนนความพึงพอใจเฉลี่ย', value: (r) => (r.csatAvg == null ? null : r.csatAvg.toFixed(2)) },
    { header: 'จำนวนที่ให้คะแนน', value: (r) => r.csatCount },
  ];
  return csvResponse(toCsv(columns, agents), `agents-${days}d-${stamp}.csv`);
});
