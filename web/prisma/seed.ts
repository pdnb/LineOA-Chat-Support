/* Dev seed: the default LINE OA, an admin, a demo agent, a mock integration and three categories. Safe to re-run. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';
import { DEFAULT_CHANNEL_ID, importEnvCredentials } from '../src/server/line/channels';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, name: 'ผู้ดูแลระบบ', role: 'ADMIN', passwordHash },
    update: {},
  });
  // The migration creates the default OA; this keeps a freshly reset database seeded too.
  await prisma.lineChannel.upsert({
    where: { id: DEFAULT_CHANNEL_ID },
    create: { id: DEFAULT_CHANNEL_ID, name: 'LINE OA หลัก' },
    update: {},
  });
  await importEnvCredentials(prisma);

  await prisma.user.upsert({
    where: { email: 'agent@example.com' },
    create: {
      email: 'agent@example.com',
      name: 'เจ้าหน้าที่ A',
      role: 'AGENT',
      passwordHash,
      channels: { connect: { id: DEFAULT_CHANNEL_ID } },
    },
    update: {},
  });

  const integration =
    (await prisma.integration.findFirst({ where: { name: 'Mock Receiver' } })) ??
    (await prisma.integration.create({
      data: {
        name: 'Mock Receiver',
        endpointUrl: process.env.SEED_INTEGRATION_URL ?? 'http://localhost:4001/jobs',
        secret: process.env.SEED_INTEGRATION_SECRET ?? 'dev-integration-secret',
      },
    }));

  const categories = [
    {
      code: 'repair',
      name: 'แจ้งซ่อม',
      description: 'แจ้งซ่อมอุปกรณ์/สถานที่',
      autoCreateJob: true,
      integrationId: integration.id,
      sortOrder: 1,
      form: [
        { key: 'location', label: 'สถานที่ (อาคาร/ชั้น/ห้อง)', required: true },
        { key: 'detail', label: 'อาการ/รายละเอียดปัญหา', required: true },
        { key: 'phone', label: 'เบอร์โทรติดต่อกลับ', required: false },
      ],
    },
    {
      code: 'complaint',
      name: 'ร้องเรียน',
      description: 'ร้องเรียน/ข้อเสนอแนะ — เจ้าหน้าที่ตรวจสอบก่อนเปิดงาน',
      autoCreateJob: false,
      integrationId: integration.id,
      sortOrder: 2,
      form: [
        { key: 'topic', label: 'หัวข้อเรื่องที่ต้องการร้องเรียน', required: true },
        { key: 'detail', label: 'รายละเอียด', required: true },
      ],
    },
    {
      code: 'inquiry',
      name: 'สอบถามข้อมูล',
      description: 'คุยกับเจ้าหน้าที่โดยตรง',
      autoCreateJob: false,
      integrationId: null,
      sortOrder: 3,
      form: [],
    },
  ];
  for (const c of categories) {
    await prisma.category.upsert({ where: { code: c.code }, create: c, update: {} });
  }
  console.log(`Seeded. Login: ${adminEmail} / agent@example.com (password from SEED_ADMIN_PASSWORD)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
