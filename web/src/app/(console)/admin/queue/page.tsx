'use client';

import { DeleteOutlined, RedoOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Flex, InputNumber, Popconfirm, Segmented, Select, Table, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ToneTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { fmtDateTime, Tone } from '@/lib/format';
import { QueueTask } from '@/lib/types';

type Status = QueueTask['status'];

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  FAILED: { label: 'ล้มเหลว', tone: 'red' },
  PENDING: { label: 'รอทำงาน', tone: 'amber' },
  RUNNING: { label: 'กำลังทำงาน', tone: 'blue' },
  DONE: { label: 'เสร็จแล้ว', tone: 'green' },
};

const QUEUES: Record<string, string> = {
  'line-events': 'รับ event จาก LINE',
  'job-dispatch': 'ส่งงานไประบบปลายทาง',
  'line-push': 'ส่งข้อความหาลูกค้า',
};

interface Page {
  items: QueueTask[];
  total: number;
  stats: { queue: string; status: Status; count: number }[];
}

const PAGE_SIZE = 20;

export default function QueuePage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [status, setStatus] = useState<Status>('FAILED');
  const [queue, setQueue] = useState('');
  const [page, setPage] = useState(1);
  const [purgeDays, setPurgeDays] = useState(7);

  const list = useQuery({
    queryKey: ['queue-tasks', status, queue, page],
    queryFn: () =>
      api<Page>(`/api/queue-tasks?status=${status}&queue=${queue}&take=${PAGE_SIZE}&skip=${(page - 1) * PAGE_SIZE}`),
    refetchInterval: 15_000,
  });
  const count = (s: Status) =>
    (list.data?.stats ?? []).filter((r) => r.status === s && (!queue || r.queue === queue)).reduce((a, r) => a + r.count, 0);

  const done = (text: string) => {
    qc.invalidateQueries({ queryKey: ['queue-tasks'] });
    message.success(text);
  };
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/queue-tasks/${id}/retry`, { method: 'POST' }),
    onSuccess: () => done('ส่งกลับเข้าคิวแล้ว'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/queue-tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => done('ลบแล้ว'),
  });
  const retryAll = useMutation({
    mutationFn: () => api<{ count: number }>('/api/queue-tasks/retry-failed', { method: 'POST', json: { queue: queue || undefined } }),
    onSuccess: (r) => done(`ส่งกลับเข้าคิว ${r.count} งาน`),
  });
  const purge = useMutation({
    mutationFn: () => api<{ count: number }>('/api/queue-tasks/purge', { method: 'POST', json: { olderThanDays: purgeDays } }),
    onSuccess: (r) => done(`ลบงานที่เสร็จแล้ว ${r.count} งาน`),
  });

  return (
    <>
      <PageHeader title="งานค้างในคิว">
        <Popconfirm
          title="ลองใหม่ทุกงานที่ล้มเหลว?"
          description={queue ? `เฉพาะคิว ${QUEUES[queue] ?? queue}` : 'ทุกคิว'}
          okText="ลองใหม่"
          cancelText="ยกเลิก"
          onConfirm={() => retryAll.mutateAsync()}
        >
          <Button icon={<RedoOutlined />} disabled={!count('FAILED')} loading={retryAll.isPending}>
            ลองใหม่ทั้งหมด
          </Button>
        </Popconfirm>
        <Flex align="center" gap={6}>
          <InputNumber size="middle" min={0} max={3650} value={purgeDays} onChange={(v) => setPurgeDays(v ?? 0)} suffix="วัน" style={{ width: 96 }} />
          <Popconfirm
            title={`ลบงานที่เสร็จแล้วที่เก่ากว่า ${purgeDays} วัน?`}
            okText="ลบ"
            okButtonProps={{ danger: true }}
            cancelText="ยกเลิก"
            onConfirm={() => purge.mutateAsync()}
          >
            <Button loading={purge.isPending}>ล้างงานที่เสร็จแล้ว</Button>
          </Popconfirm>
        </Flex>
      </PageHeader>
      <PageBody>
        <Flex vertical gap={16}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            งานเบื้องหลังที่ลองซ้ำครบจำนวนแล้วยังไม่สำเร็จจะค้างเป็น “ล้มเหลว” ตรวจสาเหตุแล้วกดลองใหม่ได้ งานที่เสร็จแล้วจะถูกลบอัตโนมัติหลัง 7 วัน
          </Typography.Paragraph>
          <Flex wrap align="center" gap={12}>
            <Segmented<Status>
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={(Object.keys(STATUS) as Status[]).map((s) => ({ value: s, label: `${STATUS[s].label} (${count(s)})` }))}
            />
            <Select
              style={{ width: 220 }}
              value={queue}
              onChange={(v) => {
                setQueue(v);
                setPage(1);
              }}
              aria-label="คิว"
              options={[{ value: '', label: 'ทุกคิว' }, ...Object.entries(QUEUES).map(([value, label]) => ({ value, label }))]}
            />
          </Flex>
          <ErrorAlert error={list.error ?? retry.error ?? remove.error ?? retryAll.error ?? purge.error} style={{ marginBottom: 0 }} />
          <Table<QueueTask>
            rowKey="id"
            size="small"
            loading={list.isLoading}
            dataSource={list.data?.items}
            scroll={{ x: 760 }}
            pagination={{ current: page, pageSize: PAGE_SIZE, total: list.data?.total, onChange: setPage, showSizeChanger: false }}
            expandable={{
              expandedRowRender: (t) => (
                <Flex vertical gap={8}>
                  {t.queue === 'line-push' && t.status === 'FAILED' && (
                    <Alert type="warning" showIcon title="ถ้าลองใหม่ ลูกค้าอาจได้รับข้อความซ้ำ หากครั้งก่อนส่งถึงแล้วบางส่วน" />
                  )}
                  {t.lastError && (
                    <Typography.Text type="danger" style={{ whiteSpace: 'pre-wrap' }}>
                      {t.lastError}
                    </Typography.Text>
                  )}
                  <pre style={{ margin: 0, maxHeight: 320, overflow: 'auto', fontSize: 12, background: '#f9fafb', padding: 12, borderRadius: 8 }}>
                    {JSON.stringify(t.payload, null, 2)}
                  </pre>
                </Flex>
              ),
            }}
            columns={[
              { title: 'คิว', dataIndex: 'queue', render: (q: string) => QUEUES[q] ?? q, width: 180 },
              {
                title: 'สถานะ',
                dataIndex: 'status',
                width: 110,
                render: (s: Status) => <ToneTag tone={STATUS[s].tone}>{STATUS[s].label}</ToneTag>,
              },
              { title: 'ครั้งที่ลอง', render: (_, t) => `${t.attempts}/${t.maxAttempts}`, width: 90 },
              { title: 'ข้อผิดพลาดล่าสุด', dataIndex: 'lastError', ellipsis: true, render: (e: string | null) => e ?? '-' },
              { title: 'อัปเดต', dataIndex: 'updatedAt', render: fmtDateTime, width: 170 },
              {
                title: '',
                width: 88,
                render: (_, t) => (
                  <Flex gap={4}>
                    {t.status === 'FAILED' && (
                      <Tooltip title="ลองใหม่">
                        <Button
                          size="small"
                          icon={<RedoOutlined />}
                          loading={retry.isPending && retry.variables === t.id}
                          onClick={() => retry.mutate(t.id)}
                          aria-label="ลองใหม่"
                        />
                      </Tooltip>
                    )}
                    {(t.status === 'FAILED' || t.status === 'DONE') && (
                      <Popconfirm title="ลบงานนี้?" okText="ลบ" okButtonProps={{ danger: true }} cancelText="ยกเลิก" onConfirm={() => remove.mutateAsync(t.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} aria-label="ลบ" />
                      </Popconfirm>
                    )}
                  </Flex>
                ),
              },
            ]}
          />
        </Flex>
      </PageBody>
    </>
  );
}
