'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Switch, Table, Typography } from 'antd';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ChannelTag, ToneTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { useLineChannels } from '@/lib/channels';
import { CANNED_VARIABLES } from '@/lib/template';
import { CannedReply } from '@/lib/types';

type Draft = Omit<CannedReply, 'id'> & { id?: string };

const EMPTY: Draft = { shortcut: '', title: '', text: '', channelId: null, sortOrder: 0, isActive: true };
const ALL = '';

export default function CannedRepliesPage() {
  const qc = useQueryClient();
  const { modal } = App.useApp();
  const { channels } = useLineChannels();
  const list = useQuery({ queryKey: ['canned', 'admin'], queryFn: () => api<CannedReply[]>('/api/canned-replies?all=1') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const channelName = (id: string | null) => channels.find((c) => c.id === id)?.name ?? id;

  const refresh = () => qc.invalidateQueries({ queryKey: ['canned'] });
  const save = useMutation({
    mutationFn: ({ id, ...body }: Draft) => {
      const json = { ...body, title: body.title || null, channelId: body.channelId || null };
      return id ? api(`/api/canned-replies/${id}`, { method: 'PUT', json }) : api('/api/canned-replies', { method: 'POST', json });
    },
    onSuccess: () => {
      refresh();
      setDraft(null);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, ...r }: CannedReply) => api(`/api/canned-replies/${id}`, { method: 'PUT', json: { ...r, isActive: !r.isActive } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/canned-replies/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  function confirmRemove(r: CannedReply) {
    modal.confirm({
      title: `ลบ /${r.shortcut}?`,
      okText: 'ลบ',
      okButtonProps: { danger: true },
      cancelText: 'ยกเลิก',
      onOk: () => remove.mutateAsync(r.id),
    });
  }

  return (
    <>
      <PageHeader title="ข้อความสำเร็จรูป">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setDraft({ ...EMPTY, sortOrder: (list.data?.length ?? 0) + 1 })}>
          เพิ่มข้อความ
        </Button>
      </PageHeader>
      <PageBody>
        <Flex vertical gap={12}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            เจ้าหน้าที่พิมพ์ <code>/</code> ตามด้วยคำสั่งในช่องข้อความเพื่อเลือกข้อความ ตัวแปรจะถูกแทนค่าก่อนส่ง:{' '}
            {CANNED_VARIABLES.map((v) => (
              <span key={v.key} style={{ marginInlineEnd: 8 }}>
                <code>{v.key}</code> {v.label}
              </span>
            ))}
          </Typography.Paragraph>
          <ErrorAlert error={remove.error ?? toggle.error} style={{ marginBottom: 0 }} />
          <Table<CannedReply>
            rowKey="id"
            size="small"
            loading={list.isLoading}
            dataSource={list.data}
            pagination={false}
            scroll={{ x: 720 }}
            columns={[
              {
                title: 'คำสั่ง',
                dataIndex: 'shortcut',
                width: 140,
                render: (s: string) => <Typography.Text code>/{s}</Typography.Text>,
              },
              {
                title: 'ข้อความ',
                render: (_, r) => (
                  <>
                    {r.title && <Typography.Text strong style={{ display: 'block' }}>{r.title}</Typography.Text>}
                    <Typography.Text type="secondary" ellipsis={{ tooltip: r.text }} style={{ maxWidth: 420, display: 'block' }}>
                      {r.text}
                    </Typography.Text>
                  </>
                ),
              },
              {
                title: 'ใช้กับ',
                dataIndex: 'channelId',
                width: 160,
                render: (id: string | null) => (id ? <ChannelTag>{channelName(id)}</ChannelTag> : <ToneTag>ทุก OA</ToneTag>),
              },
              { title: 'ลำดับ', dataIndex: 'sortOrder', width: 70 },
              {
                title: 'ใช้งาน',
                width: 80,
                render: (_, r) => (
                  <Switch
                    size="small"
                    checked={r.isActive}
                    loading={toggle.isPending && toggle.variables?.id === r.id}
                    onChange={() => toggle.mutate(r)}
                  />
                ),
              },
              {
                title: '',
                width: 110,
                render: (_, r) => (
                  <Flex gap={4}>
                    <Button size="small" onClick={() => setDraft({ ...r, title: r.title ?? '' })}>
                      แก้ไข
                    </Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => confirmRemove(r)} aria-label="ลบ" />
                  </Flex>
                ),
              },
            ]}
          />
        </Flex>
      </PageBody>

      <Modal
        open={!!draft}
        onCancel={() => setDraft(null)}
        title={draft?.id ? 'แก้ไขข้อความสำเร็จรูป' : 'เพิ่มข้อความสำเร็จรูป'}
        okText="บันทึก"
        cancelText="ยกเลิก"
        okButtonProps={{ loading: save.isPending }}
        onOk={() => draft && save.mutate(draft)}
        destroyOnHidden
      >
        {draft && (
          <Form layout="vertical">
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item label="คำสั่ง" extra="a-z 0-9 ภาษาไทย _ -">
                  <Input
                    prefix="/"
                    maxLength={30}
                    value={draft.shortcut}
                    onChange={(e) => setDraft({ ...draft, shortcut: e.target.value.toLowerCase().replace(/\s/g, '') })}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="ชื่อเรียก (ไม่บังคับ)">
                  <Input maxLength={100} value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="ข้อความ">
              <Input.TextArea rows={4} maxLength={5000} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </Form.Item>
            <Flex wrap gap={6} style={{ marginTop: -12, marginBottom: 16 }}>
              {CANNED_VARIABLES.map((v) => (
                <Button key={v.key} size="small" type="dashed" onClick={() => setDraft({ ...draft, text: draft.text + v.key })}>
                  {v.key} {v.label}
                </Button>
              ))}
            </Flex>
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Form.Item label="ใช้กับ LINE OA">
                  <Select
                    value={draft.channelId ?? ALL}
                    onChange={(v: string) => setDraft({ ...draft, channelId: v || null })}
                    options={[{ value: ALL, label: 'ทุก OA' }, ...channels.map((c) => ({ value: c.id, label: c.name }))]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item label="ลำดับ">
                  <InputNumber style={{ width: '100%' }} value={draft.sortOrder} onChange={(v) => setDraft({ ...draft, sortOrder: v ?? 0 })} />
                </Form.Item>
              </Col>
            </Row>
            <ErrorAlert error={save.error} style={{ marginBottom: 0 }} />
          </Form>
        )}
      </Modal>
    </>
  );
}
