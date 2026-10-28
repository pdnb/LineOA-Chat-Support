'use client';

import { PlusOutlined, StarFilled } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Descriptions, Empty, Flex, Input, Select, Typography } from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { Contact, Conversation, ConversationDetail, Job } from '@/lib/types';
import { useOnline } from '../AppShell';
import styles from '../chat.module.css';
import { ChannelTag, ConversationStatusTag, JobStatusTag } from '../StatusTag';
import { UserAvatar } from '../UserAvatar';

function SectionTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
      <Typography.Text type="secondary" strong style={{ fontSize: 12, letterSpacing: 0.4 }}>
        {children}
      </Typography.Text>
      {extra}
    </Flex>
  );
}

export function ContactPanel({ conversation, onCreateJob }: { conversation: ConversationDetail; onCreateJob(): void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const contactId = conversation.contactId;
  const contact = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => api<Contact & { jobs: Job[]; conversations: Conversation[] }>(`/api/contacts/${contactId}`),
  });
  const knownTags = useQuery({
    queryKey: ['contact-tags', conversation.channelId],
    queryFn: () => api<string[]>(`/api/contacts/tags?channelId=${conversation.channelId}`),
    staleTime: 60_000,
  });
  const [form, setForm] = useState<{ phone: string; note: string; tags: string[] }>({ phone: '', note: '', tags: [] });
  const data = contact.data;
  useEffect(() => {
    if (data) setForm({ phone: data.phone ?? '', note: data.note ?? '', tags: data.tags });
  }, [data?.id, data?.phone, data?.note, data?.tags.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () =>
      api(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        json: {
          phone: form.phone,
          note: form.note,
          tags: [...new Set(form.tags.map((t) => t.trim()).filter(Boolean))],
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      qc.invalidateQueries({ queryKey: ['contact-tags'] });
    },
  });

  const collected = conversation.collected ?? {};
  const fields = conversation.category?.form ?? [];
  const dirty = data && (form.phone !== (data.phone ?? '') || form.note !== (data.note ?? '') || form.tags.join(',') !== data.tags.join(','));
  const assignee = conversation.assignedTo;

  return (
    <aside className={styles.panel}>
      <Flex vertical gap={20}>
        <Flex vertical align="center" gap={6} style={{ textAlign: 'center' }}>
          <UserAvatar name={conversation.contact.displayName} src={conversation.contact.pictureUrl} size={64} />
          <Typography.Text strong>{conversation.contact.displayName}</Typography.Text>
          <ChannelTag>
            LINE OA: {conversation.channel.name}
            {conversation.channel.basicId ? ` (${conversation.channel.basicId})` : ''}
          </ChannelTag>
          <Typography.Text type="secondary" code style={{ fontSize: 11 }}>
            {conversation.contact.lineUserId}
          </Typography.Text>
        </Flex>

        {fields.length > 0 && (
          <div>
            <SectionTitle>ข้อมูลจาก Bot · {conversation.category?.name}</SectionTitle>
            <Descriptions
              size="small"
              column={1}
              bordered
              items={fields.map((f) => ({ key: f.key, label: f.label, children: collected[f.key] || '-' }))}
            />
          </div>
        )}

        <Flex vertical gap={8}>
          <SectionTitle>ข้อมูลลูกค้า</SectionTitle>
          <Input placeholder="เบอร์โทร" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select
            mode="tags"
            placeholder="แท็ก เช่น VIP"
            value={form.tags}
            onChange={(tags: string[]) => setForm({ ...form, tags })}
            tokenSeparators={[',']}
            aria-label="แท็ก"
            options={(knownTags.data ?? []).map((t) => ({ value: t, label: t }))}
          />
          <Input.TextArea rows={3} placeholder="บันทึกภายใน" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          {dirty && (
            <Button type="primary" size="small" style={{ alignSelf: 'flex-start' }} loading={save.isPending} onClick={() => save.mutate()}>
              บันทึก
            </Button>
          )}
        </Flex>

        <div>
          <SectionTitle
            extra={
              <Button size="small" type="text" icon={<PlusOutlined />} onClick={onCreateJob}>
                สร้าง
              </Button>
            }
          >
            งานของลูกค้า
          </SectionTitle>
          {data?.jobs.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีงาน" />}
          <Flex vertical gap={6}>
            {data?.jobs.map((j) => (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                style={{ display: 'block', padding: 10, border: '1px solid var(--border)', borderRadius: 8, color: 'inherit' }}
              >
                <Flex align="center" justify="space-between" gap={8}>
                  <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {j.number}
                  </Typography.Text>
                  <JobStatusTag status={j.status} />
                </Flex>
                <Typography.Text ellipsis style={{ display: 'block', marginTop: 2 }}>
                  {j.title}
                </Typography.Text>
              </Link>
            ))}
          </Flex>
        </div>

        {(data?.conversations.length ?? 0) > 1 && (
          <div>
            <SectionTitle>ประวัติแชต</SectionTitle>
            <Flex vertical gap={4}>
              {data?.conversations.map((h) => (
                <Link
                  key={h.id}
                  href={`/inbox/${h.id}`}
                  style={{
                    display: 'block',
                    padding: '6px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'inherit',
                    background: h.id === conversation.id ? 'var(--brand-soft)' : undefined,
                  }}
                >
                  <Flex align="center" justify="space-between" gap={6}>
                    <ConversationStatusTag status={h.status} />
                    {h.csatRating != null && (
                      <Typography.Text style={{ fontSize: 12, color: '#ca8a04' }}>
                        <StarFilled /> {h.csatRating}
                      </Typography.Text>
                    )}
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginInlineStart: 'auto' }}>
                      {fmtRelative(h.createdAt)}
                    </Typography.Text>
                  </Flex>
                  <Typography.Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
                    {h.lastMessageText}
                  </Typography.Text>
                </Link>
              ))}
            </Flex>
          </div>
        )}

        {assignee && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ผู้ดูแล: {assignee.name}{' '}
            <Badge
              status={online.includes(assignee.id) ? 'success' : 'default'}
              text={online.includes(assignee.id) ? 'ออนไลน์' : 'ออฟไลน์'}
            />
          </Typography.Text>
        )}
      </Flex>
    </aside>
  );
}
