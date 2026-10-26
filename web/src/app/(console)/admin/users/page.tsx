'use client';

import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Col, Flex, Form, Input, Modal, Row, Select, Switch, Typography } from 'antd';
import { useState } from 'react';
import { useOnline } from '@/components/AppShell';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ChannelTag, ToneTag } from '@/components/StatusTag';
import { UserAvatar } from '@/components/UserAvatar';
import { api } from '@/lib/api';
import { useLineChannels } from '@/lib/channels';
import { fmtDateTime } from '@/lib/format';
import { Role, User } from '@/lib/types';

interface Draft {
  id?: string;
  email: string;
  name: string;
  password: string;
  role: Role;
  isActive: boolean;
  channelIds: string[];
}

export default function UsersPage() {
  const qc = useQueryClient();
  const online = useOnline();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/users') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const { channels } = useLineChannels();
  const channelName = (id: string) => channels.find((ch) => ch.id === id)?.name ?? id;

  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? api(`/api/users/${d.id}`, {
            method: 'PATCH',
            json: {
              name: d.name,
              role: d.role,
              isActive: d.isActive,
              channelIds: d.channelIds,
              ...(d.password ? { password: d.password } : {}),
            },
          })
        : api('/api/users', {
            method: 'POST',
            json: {
              email: d.email,
              name: d.name,
              role: d.role,
              channelIds: d.channelIds,
              ...(d.password ? { password: d.password } : {}),
            },
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setDraft(null);
    },
  });

  return (
    <>
      <PageHeader title="เจ้าหน้าที่">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() =>
            setDraft({ email: '', name: '', password: '', role: 'AGENT', isActive: true, channelIds: channels.length === 1 ? [channels[0].id] : [] })
          }
        >
          เพิ่มเจ้าหน้าที่
        </Button>
      </PageHeader>
      <PageBody>
        <Card loading={users.isLoading} styles={{ body: { padding: 0 } }}>
          {users.data?.map((u, i) => (
            <Flex
              key={u.id}
              wrap
              align="center"
              gap={12}
              style={{ padding: '14px 16px', borderTop: i ? '1px solid var(--border)' : undefined }}
            >
              <UserAvatar name={u.name} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Flex align="center" gap={8}>
                  <Typography.Text strong>{u.name}</Typography.Text>
                  {online.includes(u.id) && <Badge status="success" title="ออนไลน์" />}
                </Flex>
                <Typography.Text type="secondary">{u.email}</Typography.Text>
              </div>
              <ToneTag tone={u.role === 'ADMIN' ? 'violet' : 'neutral'}>{u.role === 'ADMIN' ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่'}</ToneTag>
              {u.role === 'AGENT' &&
                (u.channelIds?.length ? (
                  u.channelIds.map((id) => <ChannelTag key={id}>{channelName(id)}</ChannelTag>)
                ) : (
                  <ToneTag tone="amber">ยังไม่ได้รับ LINE OA</ToneTag>
                ))}
              {u.auth0Linked && <ToneTag tone="neutral">Auth0</ToneTag>}
              {!u.isActive && <ToneTag tone="red">ปิดใช้งาน</ToneTag>}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {u.lastSeenAt ? `ใช้งานล่าสุด ${fmtDateTime(u.lastSeenAt)}` : 'ยังไม่เคยเข้าใช้'}
              </Typography.Text>
              <Button
                size="small"
                onClick={() =>
                  setDraft({
                    id: u.id,
                    email: u.email,
                    name: u.name,
                    password: '',
                    role: u.role,
                    isActive: u.isActive ?? true,
                    channelIds: u.channelIds ?? [],
                  })
                }
              >
                แก้ไข
              </Button>
            </Flex>
          ))}
        </Card>
      </PageBody>

      <Modal
        open={!!draft}
        onCancel={() => setDraft(null)}
        title={draft?.id ? 'แก้ไขเจ้าหน้าที่' : 'เพิ่มเจ้าหน้าที่'}
        okText="บันทึก"
        cancelText="ยกเลิก"
        okButtonProps={{ loading: save.isPending }}
        onOk={() => draft && save.mutate(draft)}
        destroyOnHidden
      >
        {draft && (
          <Form layout="vertical">
            <Form.Item label="อีเมล">
              <Input type="email" value={draft.email} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </Form.Item>
            <Form.Item label="ชื่อที่แสดง">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Form.Item>
            <Form.Item
              label={draft.id ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน (อย่างน้อย 8 ตัว)'}
              extra={draft.id ? undefined : 'เว้นว่างถ้าเข้าสู่ระบบด้วย Auth0 เท่านั้น (ใช้อีเมลเดียวกับใน Auth0)'}
            >
              <Input.Password
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </Form.Item>
            <Row gutter={16} align="middle">
              <Col span={12}>
                <Form.Item label="สิทธิ์">
                  <Select
                    value={draft.role}
                    onChange={(role: Role) => setDraft({ ...draft, role })}
                    options={[
                      { value: 'AGENT', label: 'เจ้าหน้าที่' },
                      { value: 'ADMIN', label: 'ผู้ดูแลระบบ' },
                    ]}
                  />
                </Form.Item>
              </Col>
              {draft.id && (
                <Col span={12}>
                  <Flex align="center" gap={8} style={{ marginTop: 8 }}>
                    <Switch size="small" checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} />
                    เปิดใช้งาน
                  </Flex>
                </Col>
              )}
            </Row>
            {draft.role === 'AGENT' ? (
              <Form.Item label="LINE OA ที่ดูแล" extra="เห็นและตอบได้เฉพาะแชตและงานของ OA ที่เลือก">
                <Select
                  mode="multiple"
                  value={draft.channelIds}
                  onChange={(channelIds: string[]) => setDraft({ ...draft, channelIds })}
                  options={channels.map((ch) => ({ value: ch.id, label: ch.name }))}
                  placeholder="เลือก LINE OA"
                />
              </Form.Item>
            ) : (
              <Typography.Paragraph type="secondary">ผู้ดูแลระบบเห็นทุก LINE OA</Typography.Paragraph>
            )}
            <ErrorAlert error={save.error} style={{ marginBottom: 0 }} />
          </Form>
        )}
      </Modal>
    </>
  );
}
