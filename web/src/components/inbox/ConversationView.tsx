'use client';

import {
  ArrowLeftOutlined,
  AudioOutlined,
  CheckCircleOutlined,
  FileOutlined,
  LayoutOutlined,
  PaperClipOutlined,
  PictureOutlined,
  RollbackOutlined,
  SendOutlined,
  SolutionOutlined,
  StarFilled,
  SwapOutlined,
  UndoOutlined,
  UserAddOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dropdown, Flex, Input, Modal, Select, Spin, Tag, Tooltip, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ATTACH_ACCEPT, AttachKind, attachmentForm } from '@/lib/attachments';
import { useAuth } from '@/lib/auth';
import { useLineChannels } from '@/lib/channels';
import { fillCanned } from '@/lib/template';
import { CannedReply, ConversationDetail, Message, User } from '@/lib/types';
import { useOnline } from '../AppShell';
import styles from '../chat.module.css';
import { CreateJobModal } from '../CreateJobModal';
import { ErrorAlert } from '../ErrorAlert';
import { MessageBubble } from '../MessageBubble';
import { ChannelTag, ConversationStatusTag } from '../StatusTag';
import { UserAvatar } from '../UserAvatar';
import { CannedPicker, cannedQuery, filterCanned } from './CannedPicker';
import { ContactPanel } from './ContactPanel';
import { SlaTimer, useSlaConfig } from './SlaTimer';
import { StickerPicker } from './StickerPicker';

const byTime = (a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function ConversationView({ id }: { id: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const online = useOnline();
  const sla = useSlaConfig();
  const [text, setText] = useState('');
  const [showPanel, setShowPanel] = useState(true);
  const [jobOpen, setJobOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState<string>();
  const [transferNote, setTransferNote] = useState('');
  const [pickIndex, setPickIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  /** Every message loaded so far (older pages + latest pages), so nothing disappears while scrolling back. */
  const [loaded, setLoaded] = useState<Record<string, Message>>({});
  const [olderHasMore, setOlderHasMore] = useState<boolean>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevHeight = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachKind, setAttachKind] = useState<AttachKind>('image');

  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => api<ConversationDetail>(`/api/conversations/${id}`) });
  const c = conv.data;
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/users') });
  const canned = useQuery({
    queryKey: ['canned', c?.channelId],
    queryFn: () => api<CannedReply[]>(`/api/canned-replies?channelId=${c!.channelId}`),
    enabled: !!c,
    staleTime: 60_000,
  });
  const { multi } = useLineChannels();

  useEffect(() => {
    setLoaded({});
    setOlderHasMore(undefined);
    setText('');
  }, [id]);

  const messages = (() => {
    const all = { ...loaded };
    for (const m of c?.messages ?? []) all[m.id] = m;
    return Object.values(all).sort(byTime);
  })();
  const hasOlder = olderHasMore ?? c?.hasMoreMessages ?? false;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['conversation', id] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['counts'] });
  };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(`/api/conversations/${id}/${path}`, { method: 'POST', json: body ?? {} }),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ['contact', c?.contactId] });
    },
  });
  const send = useMutation({
    mutationFn: (t: string) => api(`/api/conversations/${id}/messages`, { method: 'POST', json: { text: t } }),
    onSuccess: () => {
      setText('');
      refresh();
    },
  });
  const sendSticker = useMutation({
    mutationFn: (s: { packageId: number; stickerId: number }) => api(`/api/conversations/${id}/stickers`, { method: 'POST', json: s }),
    onSuccess: refresh,
  });
  const sendFile = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: AttachKind }) =>
      api(`/api/conversations/${id}/attachments`, { method: 'POST', body: await attachmentForm(file, kind) }),
    onSuccess: refresh,
  });
  const transfer = useMutation({
    mutationFn: () => api(`/api/conversations/${id}/transfer`, { method: 'POST', json: { userId: transferTo, note: transferNote || undefined } }),
    onSuccess: () => {
      setTransferOpen(false);
      setTransferTo(undefined);
      setTransferNote('');
      refresh();
    },
  });
  const loadOlder = useMutation({
    mutationFn: (before: string) => api<{ messages: Message[]; hasMore: boolean }>(`/api/conversations/${id}/messages?before=${before}`),
    onMutate: () => {
      prevHeight.current = scrollRef.current?.scrollHeight ?? null;
    },
    onSuccess: (page) => {
      setLoaded((prev) => {
        const next = { ...prev };
        for (const m of [...(c?.messages ?? []), ...page.messages]) next[m.id] = m;
        return next;
      });
      setOlderHasMore(page.hasMore);
    },
  });

  // Keep the reading position when older messages are added above.
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prevHeight.current != null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    }
  }, [firstId]);

  // Follow new messages at the bottom (not when older ones load above).
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);

  // Load the previous page when the top of the history scrolls into view.
  useEffect(() => {
    const top = topRef.current;
    if (!top || !hasOlder) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !loadOlder.isPending && firstId) loadOlder.mutate(firstId);
      },
      { root: scrollRef.current, rootMargin: '200px 0px 0px 0px' },
    );
    io.observe(top);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOlder, firstId, loadOlder.isPending]);

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
  const canTransfer = c.status === 'ASSIGNED' && (c.assignedToId === user?.id || user?.role === 'ADMIN');
  const eligible = (users.data ?? []).filter((u) => u.isActive && (u.role === 'ADMIN' || u.channelIds?.includes(c.channelId)));

  const replies = canned.data ?? [];
  const query = pickerDismissed ? null : cannedQuery(text);
  const matches = query === null ? [] : filterCanned(replies, query);
  const fill = (r: CannedReply) =>
    fillCanned(r.text, { name: c.contact.displayName, agent: user?.name, oa: c.channel.name, phone: c.contact.phone });
  const pick = (r: CannedReply) => {
    setText(fill(r));
    setPickIndex(0);
  };

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (query !== null) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = Math.max(matches.length, 1);
        setPickIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && matches[pickIndex]) {
        e.preventDefault();
        pick(matches[pickIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickerDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) send.mutate(text.trim());
    }
  }

  function chooseFile(kind: AttachKind) {
    setAttachKind(kind);
    if (fileInput.current) {
      fileInput.current.accept = ATTACH_ACCEPT[kind];
      fileInput.current.click();
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
            <Flex wrap align="center" gap={6}>
              <ConversationStatusTag status={c.status} />
              {multi && <ChannelTag>{c.channel.name}</ChannelTag>}
              <SlaTimer conv={c} cfg={sla} />
              {c.csatRating != null && (
                <Tooltip title="คะแนนความพึงพอใจจากลูกค้า">
                  <Tag color="gold" icon={<StarFilled />} style={{ marginInlineEnd: 0 }}>
                    {c.csatRating}/5
                  </Tag>
                </Tooltip>
              )}
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
            {user?.role === 'ADMIN' && (c.status === 'QUEUED' || c.status === 'BOT') && (
              <Select
                size="small"
                style={{ width: 150 }}
                placeholder="มอบหมายให้…"
                onChange={(userId: string) => action.mutate({ path: 'assign', body: { userId } })}
                aria-label="มอบหมายให้"
                options={eligible.map((u) => ({ value: u.id, label: u.name }))}
              />
            )}
            {canTransfer && (
              <Button size="small" icon={<SwapOutlined />} onClick={() => setTransferOpen(true)}>
                โอนเรื่อง
              </Button>
            )}
            {c.status === 'ASSIGNED' && (
              <Tooltip title="ส่งกลับเข้าคิว">
                <Button size="small" icon={<RollbackOutlined />} onClick={() => action.mutate({ path: 'handoff' })} aria-label="ส่งกลับเข้าคิว" />
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

        <div className={styles.messages} ref={scrollRef}>
          <div ref={topRef} />
          {hasOlder && (
            <Flex justify="center" style={{ padding: 8 }}>
              <Button size="small" type="text" loading={loadOlder.isPending} onClick={() => firstId && loadOlder.mutate(firstId)}>
                โหลดข้อความก่อนหน้า
              </Button>
            </Flex>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        <footer className={styles.composer} style={{ position: 'relative' }}>
          {resolved ? (
            <Flex vertical align="center" gap={8}>
              <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
                แชตนี้ปิดแล้ว — ข้อความใหม่จากลูกค้าจะเปิดแชตใหม่อัตโนมัติ
              </Typography.Text>
              <Button size="small" icon={<UndoOutlined />} loading={action.isPending} onClick={() => action.mutate({ path: 'reopen' })}>
                เปิดเรื่องอีกครั้ง
              </Button>
              <ErrorAlert error={action.error} style={{ marginBottom: 0 }} />
            </Flex>
          ) : lockedByOther ? (
            <Typography.Paragraph type="secondary" style={{ textAlign: 'center', margin: 0 }}>
              แชตนี้มี {c.assignedTo?.name} ดูแลอยู่
            </Typography.Paragraph>
          ) : (
            <>
              {query !== null && <CannedPicker items={matches} active={pickIndex} onPick={pick} onHover={setPickIndex} />}
              {replies.length > 0 && (
                <Flex gap={6} className="scroll-thin" style={{ overflowX: 'auto', marginBottom: 8 }}>
                  {replies.slice(0, 8).map((r) => (
                    <Tooltip key={r.id} title={`/${r.shortcut}`}>
                      <Tag.CheckableTag
                        checked={false}
                        onChange={() => setText(fill(r))}
                        style={{ flexShrink: 0, border: '1px solid var(--border)', borderRadius: 999 }}
                      >
                        {(() => {
                          const label = r.title || r.text;
                          return label.length > 28 ? label.slice(0, 27) + '…' : label;
                        })()}
                      </Tag.CheckableTag>
                    </Tooltip>
                  ))}
                </Flex>
              )}
              <Flex align="flex-end" gap={4}>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) sendFile.mutate({ file, kind: attachKind });
                    e.target.value = '';
                  }}
                />
                <Dropdown
                  trigger={['click']}
                  menu={{
                    onClick: ({ key }) => chooseFile(key as AttachKind),
                    items: [
                      { key: 'image', icon: <PictureOutlined />, label: 'รูปภาพ (JPEG, PNG)' },
                      { key: 'video', icon: <VideoCameraOutlined />, label: 'วิดีโอ (MP4)' },
                      { key: 'audio', icon: <AudioOutlined />, label: 'เสียง (M4A)' },
                      {
                        key: 'file',
                        icon: <FileOutlined />,
                        label: (
                          <Tooltip title="LINE ไม่รับไฟล์จาก OA โดยตรง ลูกค้าจะได้รับเป็นลิงก์ดาวน์โหลด" placement="right">
                            ไฟล์เอกสาร (ส่งเป็นลิงก์)
                          </Tooltip>
                        ),
                      },
                    ],
                  }}
                >
                  <Tooltip title="แนบไฟล์">
                    <Button type="text" icon={<PaperClipOutlined />} loading={sendFile.isPending} aria-label="แนบไฟล์" />
                  </Tooltip>
                </Dropdown>
                <StickerPicker loading={sendSticker.isPending} onPick={(packageId, stickerId) => sendSticker.mutate({ packageId, stickerId })} />
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  style={{ flex: 1 }}
                  placeholder={
                    c.status === 'ASSIGNED'
                      ? 'พิมพ์ข้อความ… (/ เลือกข้อความสำเร็จรูป, Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)'
                      : 'พิมพ์เพื่อตอบ — ระบบจะรับเรื่องให้คุณอัตโนมัติ'
                  }
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPickIndex(0);
                    setPickerDismissed(false);
                  }}
                  onKeyDown={onKey}
                  aria-expanded={query !== null}
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
              <ErrorAlert
                error={send.error ?? sendFile.error ?? sendSticker.error ?? action.error ?? loadOlder.error}
                style={{ marginTop: 8, marginBottom: 0 }}
              />
            </>
          )}
        </footer>
      </section>
      {showPanel && <ContactPanel conversation={c} onCreateJob={() => setJobOpen(true)} />}
      <CreateJobModal open={jobOpen} onClose={() => setJobOpen(false)} conversation={c} />
      <Modal
        open={transferOpen}
        onCancel={() => setTransferOpen(false)}
        title="โอนเรื่องให้เจ้าหน้าที่"
        okText="โอนเรื่อง"
        cancelText="ยกเลิก"
        okButtonProps={{ disabled: !transferTo, loading: transfer.isPending }}
        onOk={() => transfer.mutate()}
        destroyOnHidden
      >
        <Flex vertical gap={12}>
          <Select
            showSearch={{ optionFilterProp: 'name' }}
            placeholder="เลือกเจ้าหน้าที่"
            value={transferTo}
            onChange={setTransferTo}
            aria-label="เจ้าหน้าที่"
            options={eligible
              .filter((u) => u.id !== c.assignedToId)
              .map((u) => ({
                value: u.id,
                name: u.name,
                label: <Badge status={online.includes(u.id) ? 'success' : 'default'} text={u.name} />,
              }))}
          />
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder="หมายเหตุถึงผู้รับเรื่อง (ไม่บังคับ) — แสดงในแชตเฉพาะเจ้าหน้าที่"
            value={transferNote}
            onChange={(e) => setTransferNote(e.target.value)}
          />
          <ErrorAlert error={transfer.error} style={{ marginBottom: 0 }} />
        </Flex>
      </Modal>
    </div>
  );
}
