'use client';

import { useQuery } from '@tanstack/react-query';
import { DatePicker, Flex, Select, Table, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { AuditLog, User } from '@/lib/types';

/** Readable names for audit actions; unknown ones show as recorded. */
const ACTIONS: Record<string, string> = {
  'conversation.assign': 'รับ/มอบหมายแชต',
  'conversation.transfer': 'โอนแชต',
  'conversation.handoff': 'ส่งแชตกลับเข้าคิว',
  'conversation.resolve': 'ปิดเรื่อง',
  'conversation.reopen': 'เปิดเรื่องอีกครั้ง',
  'user.create': 'เพิ่มเจ้าหน้าที่',
  'user.update': 'แก้ไขเจ้าหน้าที่',
  'lineChannel.create': 'เพิ่ม LINE OA',
  'lineChannel.update': 'แก้ไข LINE OA',
  'category.create': 'เพิ่มหมวดเรื่อง',
  'category.update': 'แก้ไขหมวดเรื่อง',
  'category.delete': 'ลบหมวดเรื่อง',
  'integration.create': 'เพิ่มระบบปลายทาง',
  'integration.update': 'แก้ไขระบบปลายทาง',
  'integration.rotateSecret': 'เปลี่ยน secret ระบบปลายทาง',
  'cannedReply.create': 'เพิ่มข้อความสำเร็จรูป',
  'cannedReply.update': 'แก้ไขข้อความสำเร็จรูป',
  'cannedReply.delete': 'ลบข้อความสำเร็จรูป',
  'setting.update': 'แก้ไขการตั้งค่า',
  'job.dispatch': 'ส่งงานซ้ำ',
  'queue.retry': 'ลองงานในคิวใหม่',
  'queue.retryFailed': 'ลองงานที่ล้มเหลวใหม่ทั้งหมด',
  'queue.delete': 'ลบงานในคิว',
  'queue.purge': 'ล้างงานที่เสร็จแล้ว',
  'report.export': 'ดาวน์โหลดรายงาน CSV',
};

const ENTITY_TYPES: Record<string, string> = {
  conversation: 'แชต',
  user: 'เจ้าหน้าที่',
  lineChannel: 'LINE OA',
  category: 'หมวดเรื่อง',
  integration: 'ระบบปลายทาง',
  cannedReply: 'ข้อความสำเร็จรูป',
  setting: 'การตั้งค่า',
  job: 'งาน',
  queueTask: 'คิว',
  report: 'รายงาน',
};

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState(1);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/users') });

  const params = new URLSearchParams({ take: String(PAGE_SIZE), skip: String((page - 1) * PAGE_SIZE) });
  if (entityType) params.set('entityType', entityType);
  if (action) params.set('action', action);
  if (actorId) params.set('actorId', actorId);
  if (range?.[0]) params.set('from', range[0].startOf('day').toISOString());
  if (range?.[1]) params.set('to', range[1].endOf('day').toISOString());
  const logs = useQuery({
    queryKey: ['audit-logs', params.toString()],
    queryFn: () => api<{ items: AuditLog[]; total: number }>(`/api/audit-logs?${params}`),
  });
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader title="บันทึกการใช้งาน" />
      <PageBody>
        <Flex vertical gap={16}>
          <Flex wrap gap={8}>
            <Select
              style={{ width: 170 }}
              value={entityType}
              onChange={filter(setEntityType)}
              aria-label="ประเภท"
              options={[{ value: '', label: 'ทุกประเภท' }, ...Object.entries(ENTITY_TYPES).map(([value, label]) => ({ value, label }))]}
            />
            <Select
              style={{ width: 230 }}
              value={action}
              showSearch={{ optionFilterProp: 'label' }}
              onChange={filter(setAction)}
              aria-label="การกระทำ"
              options={[{ value: '', label: 'ทุกการกระทำ' }, ...Object.entries(ACTIONS).map(([value, label]) => ({ value, label }))]}
            />
            <Select
              style={{ width: 190 }}
              value={actorId}
              showSearch={{ optionFilterProp: 'label' }}
              onChange={filter(setActorId)}
              aria-label="ผู้ใช้"
              options={[{ value: '', label: 'ทุกคน' }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))]}
            />
            <DatePicker.RangePicker value={range} onChange={filter(setRange)} allowEmpty={[true, true]} />
          </Flex>
          <ErrorAlert error={logs.error} style={{ marginBottom: 0 }} />
          <Table<AuditLog>
            rowKey="id"
            size="small"
            loading={logs.isLoading}
            dataSource={logs.data?.items}
            scroll={{ x: 720 }}
            pagination={{ current: page, pageSize: PAGE_SIZE, total: logs.data?.total, onChange: setPage, showSizeChanger: false }}
            expandable={{
              rowExpandable: (l) => l.data != null,
              expandedRowRender: (l) => (
                <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(l.data, null, 2)}</pre>
              ),
            }}
            columns={[
              { title: 'เวลา', dataIndex: 'createdAt', render: fmtDateTime, width: 170 },
              { title: 'ผู้ใช้', render: (_, l) => l.actor?.name ?? <Typography.Text type="secondary">ระบบ</Typography.Text>, width: 160 },
              { title: 'การกระทำ', dataIndex: 'action', render: (a: string) => ACTIONS[a] ?? a },
              {
                title: 'รายการ',
                render: (_, l) => (
                  <>
                    {ENTITY_TYPES[l.entityType] ?? l.entityType}{' '}
                    {l.entityId && (
                      <Typography.Text type="secondary" code style={{ fontSize: 11 }}>
                        {l.entityId.length > 12 ? l.entityId.slice(0, 8) : l.entityId}
                      </Typography.Text>
                    )}
                  </>
                ),
              },
            ]}
          />
        </Flex>
      </PageBody>
    </>
  );
}
