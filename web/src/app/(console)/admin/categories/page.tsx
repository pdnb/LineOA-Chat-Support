'use client';

import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Checkbox, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Switch, Typography } from 'antd';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ToneTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { Category, FormField } from '@/lib/types';

type Draft = Omit<Category, 'id' | 'integration'> & { id?: string };

const EMPTY: Draft = {
  code: '',
  name: '',
  description: '',
  form: [],
  integrationId: null,
  autoCreateJob: false,
  sortOrder: 0,
  isActive: true,
};

export default function CategoriesPage() {
  const qc = useQueryClient();
  const { modal } = App.useApp();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/api/categories') });
  const integrations = useQuery({
    queryKey: ['integration-options'],
    queryFn: () => api<{ id: string; name: string }[]>('/api/integrations/options'),
  });
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { id, ...body } = d;
      const json = { ...body, integrationId: body.integrationId || null, description: body.description || undefined };
      return id ? api(`/api/categories/${id}`, { method: 'PUT', json }) : api('/api/categories', { method: 'POST', json });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setDraft(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  const setField = (i: number, patch: Partial<FormField>) =>
    draft && setDraft({ ...draft, form: draft.form.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const moveField = (i: number, dir: -1 | 1) => {
    if (!draft) return;
    const form = [...draft.form];
    [form[i], form[i + dir]] = [form[i + dir], form[i]];
    setDraft({ ...draft, form });
  };

  function confirmRemove(c: Category) {
    modal.confirm({
      title: `ลบหมวด “${c.name}”?`,
      content: 'ถ้ามีการใช้งานแล้วจะปิดใช้งานแทน',
      okText: 'ลบ',
      okButtonProps: { danger: true },
      cancelText: 'ยกเลิก',
      onOk: () => remove.mutateAsync(c.id),
    });
  }

  return (
    <>
      <PageHeader title="หมวดเรื่อง & ฟอร์ม Bot">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setDraft({ ...EMPTY, sortOrder: (categories.data?.length ?? 0) + 1 })}>
          เพิ่มหมวด
        </Button>
      </PageHeader>
      <PageBody>
        <Flex vertical gap={12}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            หมวดเรื่องจะแสดงเป็นปุ่มเมนูใน LINE เมื่อลูกค้าเลือก Bot จะถามคำถามตามฟอร์มทีละข้อ ถ้าเปิด “Bot สร้างงานอัตโนมัติ”
            งานจะถูกส่งไปยังระบบปลายทางทันทีที่ลูกค้ายืนยัน มิฉะนั้นจะโอนให้เจ้าหน้าที่
          </Typography.Paragraph>
          <ErrorAlert error={remove.error} />
          {categories.data?.map((c) => (
            <Card key={c.id} size="small">
              <Flex wrap align="center" gap={16}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Flex wrap align="center" gap={8}>
                    <Typography.Text strong>{c.name}</Typography.Text>
                    <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
                      {c.code}
                    </Typography.Text>
                    {!c.isActive && <ToneTag tone="red">ปิดใช้งาน</ToneTag>}
                    {c.autoCreateJob && <ToneTag tone="green">Bot สร้างงานอัตโนมัติ</ToneTag>}
                  </Flex>
                  <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                    {c.form.length ? `${c.form.length} คำถาม: ${c.form.map((f) => f.label).join(', ')}` : 'ไม่มีคำถาม — โอนให้เจ้าหน้าที่'}
                    {c.integration && ` · ส่งไป ${c.integration.name}`}
                  </Typography.Text>
                </div>
                <Button size="small" onClick={() => setDraft({ ...c, description: c.description ?? '' })}>
                  แก้ไข
                </Button>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => confirmRemove(c)} aria-label="ลบ" />
              </Flex>
            </Card>
          ))}
        </Flex>
      </PageBody>

      <Modal
        open={!!draft}
        onCancel={() => setDraft(null)}
        title={draft?.id ? 'แก้ไขหมวดเรื่อง' : 'เพิ่มหมวดเรื่อง'}
        width={680}
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
                <Form.Item label="ชื่อ (แสดงบนปุ่ม ≤ 20 ตัวอักษร)">
                  <Input value={draft.name} maxLength={20} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="รหัส (a-z, 0-9, -)">
                  <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="ระบบปลายทาง">
                  <Select
                    value={draft.integrationId ?? ''}
                    onChange={(v: string) => setDraft({ ...draft, integrationId: v || null, autoCreateJob: v ? draft.autoCreateJob : false })}
                    options={[
                      { value: '', label: '— ไม่ส่งต่อ —' },
                      ...(integrations.data ?? []).map((i) => ({ value: i.id, label: i.name })),
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="ลำดับ">
                  <InputNumber style={{ width: '100%' }} value={draft.sortOrder} onChange={(v) => setDraft({ ...draft, sortOrder: v ?? 0 })} />
                </Form.Item>
              </Col>
            </Row>
            <Flex wrap gap={24} style={{ marginBottom: 20 }}>
              <Flex align="center" gap={8}>
                <Switch
                  size="small"
                  checked={draft.autoCreateJob}
                  disabled={!draft.integrationId}
                  onChange={(v) => setDraft({ ...draft, autoCreateJob: v })}
                />
                Bot สร้างงานอัตโนมัติ
              </Flex>
              <Flex align="center" gap={8}>
                <Switch size="small" checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} />
                เปิดใช้งาน
              </Flex>
            </Flex>

            <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
              <Typography.Text strong>คำถามในฟอร์ม</Typography.Text>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setDraft({ ...draft, form: [...draft.form, { key: `field${draft.form.length + 1}`, label: '', required: true }] })}
              >
                เพิ่มคำถาม
              </Button>
            </Flex>
            <Flex vertical gap={8}>
              {draft.form.map((f, i) => (
                <Flex key={i} wrap align="center" gap={8} style={{ padding: 8, borderRadius: 8, background: '#f9fafb' }}>
                  <Input style={{ width: 112 }} placeholder="key" value={f.key} onChange={(e) => setField(i, { key: e.target.value })} />
                  <Input
                    style={{ flex: 1, minWidth: 160 }}
                    placeholder="คำถาม เช่น สถานที่"
                    value={f.label}
                    onChange={(e) => setField(i, { label: e.target.value })}
                  />
                  <Checkbox checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })}>
                    บังคับ
                  </Checkbox>
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => moveField(i, -1)} aria-label="ขึ้น" />
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowDownOutlined />}
                    disabled={i === draft.form.length - 1}
                    onClick={() => moveField(i, 1)}
                    aria-label="ลง"
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setDraft({ ...draft, form: draft.form.filter((_, j) => j !== i) })}
                    aria-label="ลบคำถาม"
                  />
                </Flex>
              ))}
            </Flex>
            <ErrorAlert error={save.error} style={{ marginTop: 16, marginBottom: 0 }} />
          </Form>
        )}
      </Modal>
    </>
  );
}
