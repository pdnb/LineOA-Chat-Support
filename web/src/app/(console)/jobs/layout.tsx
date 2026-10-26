'use client';

import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Flex, Input, Select, Table, Typography } from 'antd';
import { useParams, useRouter } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ChannelTag, JobStatusTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { useLineChannels } from '@/lib/channels';
import { fmtDateTime, JOB_STATUS, PRIORITY } from '@/lib/format';
import { Job, JobStatus } from '@/lib/types';

/** The table lives in the layout so filters survive opening a job in the drawer. */
export default function JobsLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [q, setQ] = useState('');
  const { multi } = useLineChannels();
  const jobs = useQuery({
    queryKey: ['jobs', status, q],
    queryFn: () => api<{ items: Job[]; total: number }>(`/api/jobs?status=${status}&q=${encodeURIComponent(q)}&take=100`),
  });

  return (
    <>
      <PageHeader title="งาน (Jobs)">
        <Input
          style={{ width: 240 }}
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--text-faint)' }} />}
          placeholder="เลขที่ / หัวข้อ / ลูกค้า"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          style={{ width: 180 }}
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'ทุกสถานะ' },
            ...Object.entries(JOB_STATUS).map(([k, v]) => ({ value: k as JobStatus, label: v.label })),
          ]}
        />
      </PageHeader>
      <PageBody>
        <Table<Job>
          rowKey="id"
          size="middle"
          loading={jobs.isLoading}
          dataSource={jobs.data?.items}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: 'ยังไม่มีงาน' }}
          onRow={(j) => ({
            onClick: () => router.push(`/jobs/${j.id}`),
            style: { cursor: 'pointer', background: j.id === id ? 'var(--brand-soft)' : undefined },
          })}
          footer={jobs.data ? () => <Typography.Text type="secondary">ทั้งหมด {jobs.data.total} งาน</Typography.Text> : undefined}
          columns={[
            {
              title: 'เลขที่',
              dataIndex: 'number',
              width: 150,
              render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
            },
            {
              title: 'หัวข้อ',
              render: (_, j) => (
                <>
                  <div style={{ fontWeight: 500 }}>{j.title}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {j.category?.name ?? 'ไม่ระบุหมวด'}
                    {j.priority !== 'NORMAL' && ` · ความสำคัญ${PRIORITY[j.priority]}`}
                  </Typography.Text>
                </>
              ),
            },
            {
              title: 'ลูกค้า',
              render: (_, j) => (
                <Flex wrap align="center" gap={6}>
                  {j.contact.displayName}
                  {multi && j.contact.channel && <ChannelTag>{j.contact.channel.name}</ChannelTag>}
                </Flex>
              ),
            },
            { title: 'ปลายทาง', render: (_, j) => j.integration?.name ?? '-' },
            { title: 'สถานะ', dataIndex: 'status', width: 140, render: (s: JobStatus) => <JobStatusTag status={s} /> },
            {
              title: 'สร้างเมื่อ',
              dataIndex: 'createdAt',
              width: 170,
              render: (v: string) => <Typography.Text type="secondary">{fmtDateTime(v)}</Typography.Text>,
            },
          ]}
        />
      </PageBody>
      {children}
    </>
  );
}
