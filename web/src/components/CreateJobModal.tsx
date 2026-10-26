'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Checkbox, Col, Form, Input, Modal, Row, Select } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PRIORITY } from '@/lib/format';
import { Category, Conversation, Job, JobPriority } from '@/lib/types';
import { ErrorAlert } from './ErrorAlert';

export function CreateJobModal({
  open,
  onClose,
  conversation,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  conversation: Conversation;
  onCreated?(job: Job): void;
}) {
  const qc = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/api/categories') });
  const integrations = useQuery({
    queryKey: ['integration-options'],
    queryFn: () => api<{ id: string; name: string }[]>('/api/integrations/options'),
  });

  const [categoryId, setCategoryId] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState<JobPriority>('NORMAL');
  const [send, setSend] = useState(true);

  const active = useMemo(() => (categories.data ?? []).filter((c) => c.isActive), [categories.data]);
  const category = active.find((c) => c.id === categoryId);

  // Prefill once per opening from what the bot collected (realtime refetches must not wipe edits).
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!open) {
      setPrefilled(false);
      return;
    }
    if (prefilled || !categories.data) return;
    setPrefilled(true);
    const cat = active.find((c) => c.id === conversation.categoryId);
    setCategoryId(cat?.id ?? '');
    setIntegrationId(cat?.integrationId ?? '');
    setTitle(cat?.name ?? '');
    setFields({ ...(conversation.collected ?? {}) });
    setDetail('');
    setPriority('NORMAL');
    setSend(true);
  }, [open, prefilled, categories.data, active, conversation]);

  function pickCategory(id: string) {
    const cat = active.find((c) => c.id === id);
    setCategoryId(id);
    if (cat) {
      setIntegrationId(cat.integrationId ?? '');
      if (!title || active.some((c) => c.name === title)) setTitle(cat.name);
    }
  }

  const create = useMutation({
    mutationFn: () => {
      const payload = Object.fromEntries((category?.form ?? []).map((f) => [f.key, fields[f.key] ?? '']));
      return api<Job>('/api/jobs', {
        method: 'POST',
        json: {
          contactId: conversation.contactId,
          conversationId: conversation.id,
          categoryId: categoryId || undefined,
          integrationId: integrationId || undefined,
          title,
          detail: detail || undefined,
          payload,
          priority,
          send: send && !!integrationId,
        },
      });
    },
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['contact', conversation.contactId] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      onCreated?.(job);
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="สร้างงาน (Job)"
      width={640}
      okText={send && integrationId ? 'สร้างและส่งงาน' : 'บันทึกงาน'}
      cancelText="ยกเลิก"
      okButtonProps={{ disabled: !title.trim(), loading: create.isPending }}
      onOk={() => create.mutate()}
    >
      <Form layout="vertical">
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item label="หมวดเรื่อง">
              <Select
                value={categoryId}
                onChange={pickCategory}
                options={[{ value: '', label: '— ไม่ระบุ —' }, ...active.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="ส่งไปยังระบบ" extra={integrationId ? undefined : 'ไม่เลือก = บันทึกไว้ในระบบอย่างเดียว'}>
              <Select
                value={integrationId}
                onChange={setIntegrationId}
                options={[
                  { value: '', label: '— ไม่ส่งต่อ —' },
                  ...(integrations.data ?? []).map((i) => ({ value: i.id, label: i.name })),
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="หัวข้องาน" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Form.Item>
          </Col>
          {category?.form.map((f) => (
            <Col xs={24} sm={12} key={f.key}>
              <Form.Item label={f.label} required={f.required}>
                <Input value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
              </Form.Item>
            </Col>
          ))}
          <Col span={24}>
            <Form.Item label="รายละเอียดเพิ่มเติม">
              <Input.TextArea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="ความสำคัญ">
              <Select
                value={priority}
                onChange={setPriority}
                options={Object.entries(PRIORITY).map(([k, v]) => ({ value: k as JobPriority, label: v }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} style={{ display: 'flex', alignItems: 'center' }}>
            <Checkbox checked={send && !!integrationId} disabled={!integrationId} onChange={(e) => setSend(e.target.checked)}>
              ส่งไปยังระบบปลายทางทันที
            </Checkbox>
          </Col>
        </Row>
      </Form>
      <ErrorAlert error={create.error} style={{ marginBottom: 0 }} />
    </Modal>
  );
}
