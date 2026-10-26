'use client';

import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  LayoutOutlined,
  PictureOutlined,
  RollbackOutlined,
  SendOutlined,
  SolutionOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Input, Select, Spin, Tag, Tooltip, Typography, Upload } from 'antd';
import { useRouter } from 'next/navigation';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLineChannels } from '@/lib/channels';
import { ConversationDetail, User } from '@/lib/types';
import styles from '../chat.module.css';
import { CreateJobModal } from '../CreateJobModal';
import { ErrorAlert } from '../ErrorAlert';
import { MessageBubble } from '../MessageBubble';
import { ChannelTag, ConversationStatusTag } from '../StatusTag';
import { UserAvatar } from '../UserAvatar';
import { ContactPanel } from './ContactPanel';

export function ConversationView({ id }: { id: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [text, setText] = useState('');
  const [showPanel, setShowPanel] = useState(true);
  const [jobOpen, setJobOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => api<ConversationDetail>(`/api/conversations/${id}`) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Record<string, unknown>>('/api/settings') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/users'), enabled: user?.role === 'ADMIN' });
  const { multi } = useLineChannels();
  const canned = (settings.data?.['canned.replies'] as string[] | undefined) ?? [];
  const c = conv.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['conversation', id] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['counts'] });
  };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(`/api/conversations/${id}/${path}`, { method: 'POST', json: body ?? {} }),
    onSuccess: refresh,
  });
  const send = useMutation({
    mutationFn: (t: string) => api(`/api/conversations/${id}/messages`, { method: 'POST', json: { text: t } }),
    onSuccess: () => {
      setText('');
      refresh();
    },
  });
  const sendImage = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api(`/api/conversations/${id}/images`, { method: 'POST', body: fd });
    },
    onSuccess: refresh,
  });

  const messageCount = c?.messages.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  const unread = c?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0) action.mutate({ path: 'read' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread]);

  if (!c) {
    return (
      <Flex flex={1} align="center" justify="center">
        {conv.isError ? <Typography.Text type="secondary">ไม่พบแชต</Typography.Text> : <Spin />}
      </Flex>
    );
  }

  const resolved = c.status === 'RESOLVED';
  const lockedByOther = c.status === 'ASSIGNED' && c.assignedToId !== user?.id && user?.role !== 'ADMIN';

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (text.trim()) send.mutate(text.trim());
    }
  }

  return (
    <div className={styles.conversation}>
      <section className={styles.chat}>
        <header className={styles.chatHead}>
          <Button
            type="text"
            className={styles.mobileOnly}
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push('/inbox')}
            aria-label="กลับ"
          />
          <UserAvatar name={c.contact.displayName} src={c.contact.pictureUrl} size={34} />
          <div style={{ minWidth: 160, flex: 1 }}>
            <Typography.Text strong ellipsis style={{ display: 'block' }}>
              {c.contact.displayName ?? 'ลูกค้า'}
            </Typography.Text>
            <Flex align="center" gap={6}>
              <ConversationStatusTag status={c.status} />
              {multi && <ChannelTag>{c.channel.name}</ChannelTag>}
              {c.assignedTo && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ดูแลโดย {c.assignedTo.name}
                </Typography.Text>
              )}
            </Flex>
          </div>
          <Flex wrap align="center" justify="flex-end" gap={6}>
            {(c.status === 'QUEUED' || c.status === 'BOT') && (
              <Button type="primary" size="small" icon={<UserAddOutlined />} onClick={() => action.mutate({ path: 'assign' })}>
                รับเรื่อง
              </Button>
            )}
            {user?.role === 'ADMIN' && !resolved && (
              <Select
                size="small"
                style={{ width: 150 }}
                placeholder="มอบหมายให้…"
                value={c.assignedToId ?? undefined}
                onChange={(userId: string) => action.mutate({ path: 'assign', body: { userId } })}
                aria-label="มอบหมายให้"
                options={users.data
                  ?.filter((u) => u.isActive && (u.role === 'ADMIN' || u.channelIds?.includes(c.channelId)))
                  .map((u) => ({ value: u.id, label: u.name }))}
              />
            )}
            {c.status === 'ASSIGNED' && (
              <Tooltip title="ส่งกลับเข้าคิว">
                <Button size="small" icon={<RollbackOutlined />} onClick={() => action.mutate({ path: 'handoff' })} />
              </Tooltip>
            )}
            {!resolved && (
              <Button size="small" icon={<CheckCircleOutlined />} onClick={() => action.mutate({ path: 'resolve' })}>
                ปิดเรื่อง
              </Button>
            )}
            <Button size="small" type="primary" icon={<SolutionOutlined />} onClick={() => setJobOpen(true)}>
              สร้าง Job
            </Button>
            <Tooltip title="ข้อมูลลูกค้า">
              <Button
                type={showPanel ? 'default' : 'text'}
                size="small"
                className={styles.panelToggle}
                icon={<LayoutOutlined />}
                onClick={() => setShowPanel(!showPanel)}
                aria-label="ข้อมูลลูกค้า"
              />
            </Tooltip>
          </Flex>
        </header>

        <div className={styles.messages}>
          {c.messages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        <footer className={styles.composer}>
          {resolved ? (
            <Typography.Paragraph type="secondary" style={{ textAlign: 'center', margin: 0 }}>
              แชตนี้ปิดแล้ว — ข้อความใหม่จากลูกค้าจะเปิดแชตใหม่อัตโนมัติ
            </Typography.Paragraph>
          ) : lockedByOther ? (
            <Typography.Paragraph type="secondary" style={{ textAlign: 'center', margin: 0 }}>
              แชตนี้มี {c.assignedTo?.name} ดูแลอยู่
            </Typography.Paragraph>
          ) : (
            <>
              {canned.length > 0 && (
                <Flex gap={6} className="scroll-thin" style={{ overflowX: 'auto', marginBottom: 8 }}>
                  {canned.map((t) => (
                    <Tag.CheckableTag
                      key={t}
                      checked={false}
                      onChange={() => setText(t)}
                      style={{ flexShrink: 0, border: '1px solid var(--border)', borderRadius: 999 }}
                    >
                      {t.length > 28 ? t.slice(0, 27) + '…' : t}
                    </Tag.CheckableTag>
                  ))}
                </Flex>
              )}
              <Flex align="flex-end" gap={8}>
                <Upload
                  accept="image/jpeg,image/png"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    sendImage.mutate(file);
                    return false;
                  }}
                >
                  <Tooltip title="ส่งรูปภาพ">
                    <Button type="text" icon={<PictureOutlined />} loading={sendImage.isPending} aria-label="ส่งรูปภาพ" />
                  </Tooltip>
                </Upload>
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  style={{ flex: 1 }}
                  placeholder={
                    c.status === 'ASSIGNED'
                      ? 'พิมพ์ข้อความ… (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่)'
                      : 'พิมพ์เพื่อตอบ — ระบบจะรับเรื่องให้คุณอัตโนมัติ'
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  disabled={!text.trim()}
                  loading={send.isPending}
                  onClick={() => send.mutate(text.trim())}
                  aria-label="ส่ง"
                />
              </Flex>
              <ErrorAlert error={send.error ?? sendImage.error ?? action.error} style={{ marginTop: 8, marginBottom: 0 }} />
            </>
          )}
        </footer>
      </section>
      {showPanel && <ContactPanel conversation={c} onCreateJob={() => setJobOpen(true)} />}
      <CreateJobModal open={jobOpen} onClose={() => setJobOpen(false)} conversation={c} />
    </div>
  );
}
