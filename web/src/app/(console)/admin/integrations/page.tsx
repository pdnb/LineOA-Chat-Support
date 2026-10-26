'use client';

import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Descriptions, Flex, Form, Input, InputNumber, Modal, Row, Switch, Typography } from 'antd';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ToneTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { Integration } from '@/lib/types';

interface Draft {
  id?: string;
  name: string;
  endpointUrl: string;
  headers: string;
  timeoutMs: number;
  isActive: boolean;
}

interface TestResult {
  ok: boolean;
  status: number;
  ms: number;
  body: string;
}

const mono = { fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' } as const;

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const { modal } = App.useApp();
  const list = useQuery({ queryKey: ['integrations'], queryFn: () => api<Integration[]>('/api/integrations') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['integrations'] });
    qc.invalidateQueries({ queryKey: ['integration-options'] });
  };
  const save = useMutation({
    mutationFn: (d: Draft) => {
      let headers: Record<string, string> | undefined;
      if (d.headers.trim()) headers = JSON.parse(d.headers);
      const json = { name: d.name, endpointUrl: d.endpointUrl, headers, timeoutMs: d.timeoutMs, isActive: d.isActive };
      return d.id ? api(`/api/integrations/${d.id}`, { method: 'PUT', json }) : api('/api/integrations', { method: 'POST', json });
    },
    onSuccess: () => {
      refresh();
      setDraft(null);
    },
  });
  const test = useMutation({
    mutationFn: (id: string) => api<TestResult>(`/api/integrations/${id}/test`, { method: 'POST' }),
    onSuccess: (res, id) => setTests((t) => ({ ...t, [id]: res })),
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api(`/api/integrations/${id}/rotate-secret`, { method: 'POST' }),
    onSuccess: refresh,
  });

  function confirmRotate(id: string) {
    modal.confirm({
      title: 'สร้าง secret ใหม่?',
      content: 'ระบบปลายทางต้องอัปเดตค่าด้วย',
      okText: 'สร้างใหม่',
      okButtonProps: { danger: true },
      cancelText: 'ยกเลิก',
      onOk: () => rotate.mutateAsync(id),
    });
  }

  return (
    <>
      <PageHeader title="ระบบปลายทาง (Integrations)">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setDraft({ name: '', endpointUrl: 'https://', headers: '', timeoutMs: 10000, isActive: true })}
        >
          เพิ่มระบบ
        </Button>
      </PageHeader>
      <PageBody>
        <Flex vertical gap={12}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            งานจะถูกส่งแบบ HTTP POST (JSON) พร้อมลายเซ็น <code>X-Signature: sha256=HMAC(body, secret)</code> และ{' '}
            <code>Idempotency-Key</code> ระบบปลายทางแจ้งสถานะกลับที่ Callback URL ด้วยลายเซ็นแบบเดียวกัน — ดูรายละเอียดใน{' '}
            <code>docs/integration-api.md</code>
          </Typography.Paragraph>
          {list.data?.map((i) => (
            <Card
              key={i.id}
              size="small"
              title={
                <Flex align="center" gap={8}>
                  {i.name}
                  <ToneTag tone={i.isActive ? 'green' : 'red'}>{i.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</ToneTag>
                </Flex>
              }
              extra={
                <Flex gap={8}>
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={test.isPending && test.variables === i.id}
                    onClick={() => test.mutate(i.id)}
                  >
                    ทดสอบ
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      setDraft({
                        id: i.id,
                        name: i.name,
                        endpointUrl: i.endpointUrl,
                        headers: i.headers ? JSON.stringify(i.headers, null, 2) : '',
                        timeoutMs: i.timeoutMs,
                        isActive: i.isActive,
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
                  { key: 'endpoint', label: 'Endpoint', children: <span style={mono}>{i.endpointUrl}</span> },
                  {
                    key: 'callback',
                    label: 'Callback URL',
                    children: (
                      <Typography.Text copyable={{ text: i.callbackUrl }} style={mono}>
                        {i.callbackUrl}
                      </Typography.Text>
                    ),
                  },
                  {
                    key: 'secret',
                    label: 'Secret',
                    children: (
                      <Flex wrap align="center" gap={8}>
                        <Typography.Text copyable={{ text: i.secret }} style={mono}>
                          {revealed[i.id] ? i.secret : '••••••••••••'}
                        </Typography.Text>
                        <Button type="link" size="small" onClick={() => setRevealed({ ...revealed, [i.id]: !revealed[i.id] })}>
                          {revealed[i.id] ? 'ซ่อน' : 'แสดง'}
                        </Button>
                        <Button type="link" danger size="small" onClick={() => confirmRotate(i.id)}>
                          สร้างใหม่
                        </Button>
                      </Flex>
                    ),
                  },
                ]}
              />
              {tests[i.id] && (
                <Alert
                  type={tests[i.id].ok ? 'success' : 'error'}
                  showIcon
                  title={`${tests[i.id].ok ? 'เชื่อมต่อสำเร็จ' : 'เชื่อมต่อไม่สำเร็จ'} · HTTP ${tests[i.id].status} · ${tests[i.id].ms} ms`}
                  description={tests[i.id].body && <code style={mono}>{tests[i.id].body}</code>}
                />
              )}
            </Card>
          ))}
        </Flex>
      </PageBody>

      <Modal
        open={!!draft}
        onCancel={() => setDraft(null)}
        title={draft?.id ? 'แก้ไขระบบปลายทาง' : 'เพิ่มระบบปลายทาง'}
        okText="บันทึก"
        cancelText="ยกเลิก"
        okButtonProps={{ loading: save.isPending }}
        onOk={() => draft && save.mutate(draft)}
        destroyOnHidden
      >
        {draft && (
          <Form layout="vertical">
            <Form.Item label="ชื่อระบบ">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Form.Item>
            <Form.Item label="Endpoint URL (รับ POST)">
              <Input value={draft.endpointUrl} onChange={(e) => setDraft({ ...draft, endpointUrl: e.target.value })} />
            </Form.Item>
            <Form.Item label="Headers เพิ่มเติม (JSON)" extra='เช่น { "Authorization": "Bearer xxx" }'>
              <Input.TextArea
                rows={3}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                value={draft.headers}
                onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
              />
            </Form.Item>
            <Row gutter={16} align="middle">
              <Col span={12}>
                <Form.Item label="Timeout (ms)">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={1000}
                    max={60000}
                    step={1000}
                    value={draft.timeoutMs}
                    onChange={(v) => setDraft({ ...draft, timeoutMs: v ?? 10000 })}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Flex align="center" gap={8} style={{ marginTop: 8 }}>
                  <Switch size="small" checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} />
                  เปิดใช้งาน
                </Flex>
              </Col>
            </Row>
            {!draft.id && <Typography.Text type="secondary">ระบบจะสร้าง secret ให้อัตโนมัติหลังบันทึก</Typography.Text>}
            <ErrorAlert error={save.error} style={{ marginTop: 16, marginBottom: 0 }} />
          </Form>
        )}
      </Modal>
    </>
  );
}
