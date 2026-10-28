'use client';

import { InboxOutlined, SearchOutlined, TagOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Badge, Empty, Flex, Input, Select, Spin, Typography } from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useLineChannels } from '@/lib/channels';
import { fmtRelative } from '@/lib/format';
import { Conversation } from '@/lib/types';
import styles from '../chat.module.css';
import { ChannelTag, ConversationStatusTag, ToneTag } from '../StatusTag';
import { UserAvatar } from '../UserAvatar';
import { SlaTimer, useSlaConfig } from './SlaTimer';

type View = 'queue' | 'mine' | 'bot' | 'all' | 'resolved';
const VIEWS: { key: View; label: string }[] = [
  { key: 'queue', label: 'รอรับเรื่อง' },
  { key: 'mine', label: 'ของฉัน' },
  { key: 'bot', label: 'Bot' },
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'resolved', label: 'ปิดแล้ว' },
];
const VIEW_KEY = 'cc.inboxView';
const CHANNEL_KEY = 'cc.inboxChannel';
const TAG_KEY = 'cc.inboxTag';
const ALL = '';

export function ConversationList({ selectedId }: { selectedId?: string }) {
  const [view, setView] = useState<View>('queue');
  const [q, setQ] = useState('');
  const [channelId, setChannelId] = useState(ALL);
  const [tag, setTag] = useState(ALL);
  const { channels, multi } = useLineChannels();
  const sla = useSlaConfig();
  // A remembered OA the user no longer has access to falls back to "all".
  const channel = channels.some((ch) => ch.id === channelId) ? channelId : ALL;
  const counts = useQuery({
    queryKey: ['counts', channel],
    queryFn: () => api<Record<string, number>>(`/api/conversations/counts?channelId=${channel}`),
  });
  const tags = useQuery({
    queryKey: ['contact-tags', channel],
    queryFn: () => api<string[]>(`/api/contacts/tags?channelId=${channel}`),
    staleTime: 60_000,
  });
  const list = useQuery({
    queryKey: ['conversations', view, q, channel, tag],
    queryFn: () =>
      api<Conversation[]>(
        `/api/conversations?view=${view}&q=${encodeURIComponent(q)}&channelId=${channel}&tag=${encodeURIComponent(tag)}`,
      ),
  });

  // Read the remembered tab and OA after hydration so server and client render the same markup.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY) as View | null;
      if (saved && VIEWS.some((v) => v.key === saved)) setView(saved);
      setChannelId(localStorage.getItem(CHANNEL_KEY) ?? ALL);
      setTag(localStorage.getItem(TAG_KEY) ?? ALL);
    } catch {
      // storage unavailable
    }
  }, []);

  function changeChannel(id: string) {
    setChannelId(id);
    try {
      localStorage.setItem(CHANNEL_KEY, id);
    } catch {
      // ignore
    }
  }

  function changeTag(t: string | undefined) {
    setTag(t ?? ALL);
    try {
      localStorage.setItem(TAG_KEY, t ?? ALL);
    } catch {
      // ignore
    }
  }

  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // ignore
    }
  }

  return (
    <section className={styles.listPane} data-hidden-mobile={!!selectedId}>
      <div className={styles.listHead}>
        <Input
          variant="filled"
          className={styles.search}
          prefix={<SearchOutlined style={{ color: 'var(--text-faint)' }} />}
          placeholder="ค้นหาชื่อ เบอร์ ข้อความ"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {multi && (
          <Select
            size="small"
            value={channel}
            onChange={changeChannel}
            aria-label="LINE OA"
            style={{ width: '100%', marginTop: 8 }}
            options={[
              { value: ALL, label: 'ทุก LINE OA' },
              ...channels.map((ch) => ({ value: ch.id, label: ch.basicId ? `${ch.name} (${ch.basicId})` : ch.name })),
            ]}
          />
        )}
        {(tags.data?.length || tag) ? (
          <Select
            size="small"
            allowClear
            showSearch
            value={tag || undefined}
            onChange={changeTag}
            placeholder={
              <>
                <TagOutlined /> กรองตามแท็ก
              </>
            }
            aria-label="แท็ก"
            style={{ width: '100%', marginTop: 8 }}
            options={[...new Set([...(tags.data ?? []), ...(tag ? [tag] : [])])].map((t) => ({ value: t, label: t }))}
          />
        ) : null}
        <div role="tablist" aria-label="มุมมองแชต" className={styles.tabs}>
          {VIEWS.map((v) => {
            const n = counts.data?.[v.key] ?? 0;
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                data-active={view === v.key}
                className={styles.tab}
                onClick={() => changeView(v.key)}
              >
                {v.label}
                {n > 0 && (
                  <span className={styles.tabCount} data-urgent={v.key === 'queue'}>
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className={styles.listBody}>
        {list.isLoading && (
          <Flex justify="center" style={{ padding: 24 }}>
            <Spin />
          </Flex>
        )}
        {list.data?.length === 0 && (
          <Empty image={<InboxOutlined style={{ fontSize: 40, color: '#d1d5db' }} />} description="ไม่มีแชตในมุมมองนี้" style={{ marginTop: 48 }} />
        )}
        {list.data?.map((c) => (
          <Link key={c.id} href={`/inbox/${c.id}`} className={styles.row} data-active={c.id === selectedId}>
            <UserAvatar name={c.contact.displayName} src={c.contact.pictureUrl} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <Flex justify="space-between" align="baseline" gap={8}>
                <Typography.Text strong ellipsis>
                  {c.contact.displayName ?? 'ลูกค้า'}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                  {fmtRelative(c.lastMessageAt)}
                </Typography.Text>
              </Flex>
              <Flex align="center" gap={8}>
                <Typography.Text type="secondary" ellipsis style={{ flex: 1, fontSize: 13 }}>
                  {c.lastMessageText}
                </Typography.Text>
                <Badge count={c.unreadCount} color="var(--brand)" size="small" />
              </Flex>
              <Flex wrap align="center" gap={4} style={{ marginTop: 4 }}>
                <ConversationStatusTag status={c.status} />
                {multi && <ChannelTag>{c.channel.name}</ChannelTag>}
                {c.category && <ToneTag>{c.category.name}</ToneTag>}
                <SlaTimer conv={c} cfg={sla} />
                {c.assignedTo && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    · {c.assignedTo.name}
                  </Typography.Text>
                )}
              </Flex>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
