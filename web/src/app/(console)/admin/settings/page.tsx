'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Form, Input, Row, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { JOB_STATUS } from '@/lib/format';

const NOTIFY_STATUSES = ['SENT', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED'] as const;

interface SettingsShape {
  'bot.greeting': string;
  'bot.handoffText': string;
  'notify.templates': Record<string, string>;
  'canned.replies': string[];
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsShape>('/api/settings') });
  const [greeting, setGreeting] = useState('');
  const [handoff, setHandoff] = useState('');
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [canned, setCanned] = useState('');

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setGreeting(s['bot.greeting']);
    setHandoff(s['bot.handoffText']);
    setTemplates(s['notify.templates']);
    setCanned(s['canned.replies'].join('\n'));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      const put = (key: string, value: unknown) => api(`/api/settings/${key}`, { method: 'PUT', json: { value } });
      await put('bot.greeting', greeting);
      await put('bot.handoffText', handoff);
      await put('notify.templates', templates);
      await put('canned.replies', canned.split('\n').map((l) => l.trim()).filter(Boolean));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      message.success('บันทึกแล้ว');
    },
  });

  return (
    <>
      <PageHeader title="ตั้งค่าข้อความ">
        <Button type="primary" loading={save.isPending} disabled={!settings.data} onClick={() => save.mutate()}>
          บันทึก
        </Button>
      </PageHeader>
      <PageBody>
        <ErrorAlert error={save.error} />
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="ข้อความ Bot" style={{ height: '100%' }}>
              <Form layout="vertical">
                <Form.Item label="ข้อความต้อนรับ / เมนู">
                  <Input.TextArea rows={4} value={greeting} onChange={(e) => setGreeting(e.target.value)} />
                </Form.Item>
                <Form.Item label="ข้อความเมื่อโอนให้เจ้าหน้าที่">
                  <Input.TextArea rows={2} value={handoff} onChange={(e) => setHandoff(e.target.value)} />
                </Form.Item>
                <Form.Item label="ข้อความสำเร็จรูปของเจ้าหน้าที่" extra="หนึ่งบรรทัดต่อหนึ่งข้อความ" style={{ marginBottom: 0 }}>
                  <Input.TextArea rows={5} value={canned} onChange={(e) => setCanned(e.target.value)} />
                </Form.Item>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="แจ้งสถานะงานกลับไปที่ LINE" style={{ height: '100%' }}>
              <Typography.Paragraph type="secondary">
                ใช้ตัวแปร <code>{'{number}'}</code> <code>{'{title}'}</code> <code>{'{note}'}</code> · เว้นว่างเพื่อไม่แจ้งสถานะนั้น
              </Typography.Paragraph>
              <Form layout="vertical">
                {NOTIFY_STATUSES.map((s) => (
                  <Form.Item key={s} label={JOB_STATUS[s].label}>
                    <Input.TextArea rows={2} value={templates[s] ?? ''} onChange={(e) => setTemplates({ ...templates, [s]: e.target.value })} />
                  </Form.Item>
                ))}
              </Form>
            </Card>
          </Col>
        </Row>
      </PageBody>
    </>
  );
}
