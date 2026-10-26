'use client';

import { MessageOutlined, RedoOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Drawer, Flex, Spin, Timeline, Typography } from 'antd';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ErrorAlert } from '@/components/ErrorAlert';
import { ChannelTag, JobStatusTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { useLineChannels } from '@/lib/channels';
import { fmtDateTime, PRIORITY } from '@/lib/format';
import { Job } from '@/lib/types';

const SOURCE_LABEL = { SYSTEM: 'ระบบ', AGENT: 'เจ้าหน้าที่', INTEGRATION: 'ระบบปลายทาง' };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Text type="secondary" strong style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
      {children}
    </Typography.Text>
  );
}

export default function JobDrawerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { multi } = useLineChannels();
  const job = useQuery({ queryKey: ['job', id], queryFn: () => api<Job>(`/api/jobs/${id}`) });
  const resend = useMutation({
    mutationFn: () => api(`/api/jobs/${id}/dispatch`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
  const j = job.data;

  return (
    <Drawer
      open
      onClose={() => router.push('/jobs')}
      size={440}
      mask={{ enabled: false }}
      title={<span style={{ fontFamily: 'monospace' }}>{j?.number}</span>}
      styles={{ wrapper: { maxWidth: '100vw' } }}
    >
      {!j ? (
        <Flex justify="center" style={{ padding: 24 }}>
          {job.isError ? <Typography.Text type="secondary">ไม่พบงาน</Typography.Text> : <Spin />}
        </Flex>
      ) : (
        <Flex vertical gap={20}>
          <div>
            <JobStatusTag status={j.status} />
            <Typography.Title level={4} style={{ margin: '8px 0 0' }}>
              {j.title}
            </Typography.Title>
            <Typography.Text type="secondary">
              {j.category?.name ?? 'ไม่ระบุหมวด'} · ความสำคัญ{PRIORITY[j.priority]}
            </Typography.Text>
          </div>

          {j.status === 'FAILED' && (
            <Alert
              type="error"
              showIcon
              title={`ส่งงานไปยัง ${j.integration?.name} ไม่สำเร็จ`}
              description={j.lastError && <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{j.lastError}</code>}
            />
          )}
          {(j.status === 'FAILED' || (j.status === 'DRAFT' && j.integration)) && (
            <div>
              <Button type="primary" icon={<RedoOutlined />} loading={resend.isPending} onClick={() => resend.mutate()}>
                {j.status === 'FAILED' ? 'ส่งงานอีกครั้ง' : 'ส่งงาน'}
              </Button>
              <ErrorAlert error={resend.error} style={{ marginTop: 8, marginBottom: 0 }} />
            </div>
          )}

          <Descriptions
            size="small"
            column={1}
            items={[
              { key: 'contact', label: 'ลูกค้า', children: j.contact.displayName },
              ...(multi && j.contact.channel
                ? [{ key: 'channel', label: 'LINE OA', children: <ChannelTag>{j.contact.channel.name}</ChannelTag> }]
                : []),
              { key: 'target', label: 'ส่งไปยัง', children: j.integration?.name ?? '— ไม่ส่งต่อ —' },
              {
                key: 'ref',
                label: 'เลขอ้างอิง',
                children: <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{j.externalRef ?? '-'}</span>,
              },
              { key: 'by', label: 'สร้างโดย', children: j.createdBy?.name ?? 'Bot' },
            ]}
          />

          {Object.keys(j.payload ?? {}).length > 0 && (
            <div>
              <SectionTitle>ข้อมูลที่ส่ง</SectionTitle>
              <Descriptions
                size="small"
                column={1}
                bordered
                items={Object.entries(j.payload).map(([k, v]) => ({ key: k, label: k, children: String(v || '-') }))}
              />
            </div>
          )}
          {j.detail && <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{j.detail}</Typography.Paragraph>}

          <div>
            <SectionTitle>ไทม์ไลน์</SectionTitle>
            <Timeline
              items={j.events?.map((e) => ({
                key: e.id,
                color: 'gray',
                title: (
                  <Flex wrap align="center" gap={6}>
                    {e.status && <JobStatusTag status={e.status} />}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {SOURCE_LABEL[e.source]} · {fmtDateTime(e.createdAt)}
                    </Typography.Text>
                  </Flex>
                ),
                content: e.note,
              }))}
            />
          </div>

          {j.conversationId && (
            <Link href={`/inbox/${j.conversationId}`}>
              <MessageOutlined /> เปิดแชตที่เกี่ยวข้อง
            </Link>
          )}
        </Flex>
      )}
    </Drawer>
  );
}
