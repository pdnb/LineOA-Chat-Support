'use client';

import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Flex, Form, Input, Modal, Switch, Typography } from 'antd';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ToneTag } from '@/components/StatusTag';
import { UserAvatar } from '@/components/UserAvatar';
import { api } from '@/lib/api';
import { LineChannel } from '@/lib/types';

interface Draft {
  id?: string;
  name: string;
  channelSecret: string;
  accessToken: string;
  greeting: string;
  handoffText: string;
  botEnabled: boolean;
  csatEnabled: boolean;
  isActive: boolean;
  hasSecret: boolean;
  tokenHint: string | null;
}

interface TestResult {
  ok: boolean;
  displayName?: string;
  basicId?: string;
  error?: string;
}

const mono = { fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' } as const;

export default function LineChannelsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['line-channels'], queryFn: () => api<LineChannel[]>('/api/line-channels') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Record<string, unknown>>('/api/settings') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['line-channels'] });
    qc.invalidateQueries({ queryKey: ['line-channel-options'] });
  };
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const json = {
        name: d.name,
        channelSecret: d.channelSecret,
        accessToken: d.accessToken,
        greeting: d.greeting,
        handoffText: d.handoffText,
        botEnabled: d.botEnabled,
        csatEnabled: d.csatEnabled,
        isActive: d.isActive,
      };
      return d.id ? api(`/api/line-channels/${d.id}`, { method: 'PUT', json }) : api('/api/line-channels', { method: 'POST', json });
    },
    onSuccess: () => {
      refresh();
      setDraft(null);
    },
  });
  const test = useMutation({
    mutationFn: (id: string) => api<TestResult>(`/api/line-channels/${id}/test`, { method: 'POST' }),
    onSuccess: (res, id) => {
      setTests((t) => ({ ...t, [id]: res }));
      if (res.ok) refresh();
    },
  });
  const toggleBot = useMutation({
    mutationFn: (ch: LineChannel) =>
      api(`/api/line-channels/${ch.id}`, { method: 'PUT', json: { name: ch.name, botEnabled: !ch.botEnabled } }),
    onSuccess: refresh,
  });

  const blank: Draft = {
    name: '',
    channelSecret: '',
    accessToken: '',
    greeting: '',
    handoffText: '',
    botEnabled: true,
    csatEnabled: false,
    isActive: true,
    hasSecret: false,
    tokenHint: null,
  };

  return (
    <>
      <PageHeader title="บัญชี LINE OA">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setDraft(blank)}>
          เพิ่ม LINE OA
        </Button>
      </PageHeader>
      <PageBody>
        <Flex vertical gap={12}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            แต่ละ OA ใช้ Messaging API channel ของตัวเอง นำ Webhook URL ด้านล่างไปใส่ใน LINE Developers Console แล้วเปิด{' '}
            <b>Use webhook</b> หมวดเรื่องและระบบปลายทางใช้ร่วมกันทุก OA ส่วนการกำหนดว่าเจ้าหน้าที่คนไหนดูแล OA ไหน ทำได้ที่หน้า “เจ้าหน้าที่”
          </Typography.Paragraph>
          {list.data?.map((ch) => (
            <Card
              key={ch.id}
              size="small"
              title={
                <Flex align="center" gap={8}>
                  <UserAvatar name={ch.name} src={ch.pictureUrl} size={24} />
                  {ch.name}
                  {ch.basicId && <Typography.Text type="secondary">{ch.basicId}</Typography.Text>}
                  <ToneTag tone={ch.isActive ? 'green' : 'red'}>{ch.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</ToneTag>
                </Flex>
              }
              extra={
                <Flex align="center" gap={8}>
                  <Flex align="center" gap={6}>
                    <Switch
                      size="small"
                      checked={ch.botEnabled}
                      loading={toggleBot.isPending && toggleBot.variables?.id === ch.id}
                      onChange={() => toggleBot.mutate(ch)}
                    />
                    Bot
                  </Flex>
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={test.isPending && test.variables === ch.id}
                    onClick={() => test.mutate(ch.id)}
                  >
                    ทดสอบ
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      setDraft({
                        id: ch.id,
                        name: ch.name,
                        channelSecret: '',
                        accessToken: '',
                        greeting: ch.greeting ?? '',
                        handoffText: ch.handoffText ?? '',
                        botEnabled: ch.botEnabled,
                        csatEnabled: ch.csatEnabled,
                        isActive: ch.isActive,
                        hasSecret: ch.hasSecret,
                        tokenHint: ch.tokenHint,
                      })
                    }
                  >
                    แก้ไข
                  </Button>
                </Flex>
              }
            >
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'webhook',
                    label: 'Webhook URL',
                    children: (
                      <Typography.Text copyable={{ text: ch.webhookUrl }} style={mono}>
                        {ch.webhookUrl}
                      </Typography.Text>
                    ),
                  },
                  {
                    key: 'secret',
                    label: 'Channel secret',
                    children: ch.hasSecret ? 'ตั้งค่าแล้ว' : <Typography.Text type="warning">ยังไม่ได้ตั้ง (ไม่ตรวจลายเซ็น)</Typography.Text>,
                  },
                  {
                    key: 'token',
                    label: 'Access token',
                    children: ch.tokenHint ? (
                      <span style={mono}>••••{ch.tokenHint}</span>
                    ) : (
                      <Typography.Text type="warning">ยังไม่ได้ตั้ง (ใช้ stub client)</Typography.Text>
                    ),
                  },
                  {
                    key: 'texts',
                    label: 'ข้อความ Bot',
                    children: !ch.botEnabled ? (
                      <ToneTag tone="red">ปิด Bot · แชตใหม่เข้าคิวเจ้าหน้าที่ทันที</ToneTag>
                    ) : ch.greeting || ch.handoffText ? (
                      'กำหนดเอง'
                    ) : (
                      'ใช้ค่ากลางจาก “ตั้งค่าข้อความ”'
                    ),
                  },
                  {
                    key: 'csat',
                    label: 'ประเมินความพึงพอใจ',
                    children: ch.csatEnabled ? <ToneTag tone="green">ส่งเมื่อปิดเรื่อง</ToneTag> : 'ไม่ส่ง',
                  },
                ]}
              />
              {tests[ch.id] && (
                <Alert
                  type={tests[ch.id].ok ? 'success' : 'error'}
                  showIcon
                  title={
                    tests[ch.id].ok
                      ? `เชื่อมต่อสำเร็จ · ${tests[ch.id].displayName} (${tests[ch.id].basicId})`
                      : `เชื่อมต่อไม่สำเร็จ · ${tests[ch.id].error}`
                  }
                />
              )}
            </Card>
          ))}
        </Flex>
      </PageBody>

      <Modal
        open={!!draft}
        onCancel={() => setDraft(null)}
        title={draft?.id ? 'แก้ไข LINE OA' : 'เพิ่ม LINE OA'}
        okText="บันทึก"
        cancelText="ยกเลิก"
        okButtonProps={{ loading: save.isPending }}
        onOk={() => draft && save.mutate(draft)}
        destroyOnHidden
      >
        {draft && (
          <Form layout="vertical">
            <Form.Item label="ชื่อที่แสดงในระบบ">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Form.Item>
            <Form.Item label="Channel secret" extra={draft.hasSecret ? 'ตั้งค่าไว้แล้ว เว้นว่างถ้าไม่เปลี่ยน' : undefined}>
              <Input.Password
                autoComplete="off"
                value={draft.channelSecret}
                onChange={(e) => setDraft({ ...draft, channelSecret: e.target.value })}
              />
            </Form.Item>
            <Form.Item
              label="Channel access token (long-lived)"
              extra={draft.tokenHint ? `ตั้งค่าไว้แล้ว (••••${draft.tokenHint}) เว้นว่างถ้าไม่เปลี่ยน` : undefined}
            >
              <Input.Password
                autoComplete="off"
                value={draft.accessToken}
                onChange={(e) => setDraft({ ...draft, accessToken: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="ข้อความทักทาย / เมนู" extra="เว้นว่างเพื่อใช้ค่ากลาง">
              <Input.TextArea
                rows={3}
                placeholder={settings.data?.['bot.greeting'] as string | undefined}
                value={draft.greeting}
                onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="ข้อความเมื่อโอนให้เจ้าหน้าที่" extra="เว้นว่างเพื่อใช้ค่ากลาง">
              <Input.TextArea
                rows={2}
                placeholder={settings.data?.['bot.handoffText'] as string | undefined}
                value={draft.handoffText}
                onChange={(e) => setDraft({ ...draft, handoffText: e.target.value })}
              />
            </Form.Item>
            <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
              <Switch size="small" checked={draft.botEnabled} onChange={(v) => setDraft({ ...draft, botEnabled: v })} />
              เปิด Bot ตอบอัตโนมัติ (ถ้าปิด แชตใหม่จะเข้าคิวเจ้าหน้าที่ทันที)
            </Flex>
            <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
              <Switch size="small" checked={draft.csatEnabled} onChange={(v) => setDraft({ ...draft, csatEnabled: v })} />
              ส่งแบบประเมินความพึงพอใจ (1–5 ดาว) เมื่อเจ้าหน้าที่ปิดเรื่อง
            </Flex>
            {draft.csatEnabled && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -6 }}>
                ส่งแบบ push message จึงนับรวมในโควตาข้อความของ OA · แก้ข้อความคำถามได้ที่ “ตั้งค่าข้อความ & SLA”
              </Typography.Paragraph>
            )}
            <Flex align="center" gap={8}>
              <Switch size="small" checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} />
              เปิดใช้งาน (ถ้าปิด ระบบจะไม่รับ event จาก OA นี้)
            </Flex>
            <ErrorAlert error={save.error} style={{ marginTop: 16, marginBottom: 0 }} />
          </Form>
        )}
      </Modal>
    </>
  );
}
