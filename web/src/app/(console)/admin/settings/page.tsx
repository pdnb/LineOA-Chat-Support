'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Flex, Form, Input, InputNumber, Row, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { JOB_STATUS } from '@/lib/format';
import { SlaConfig } from '@/lib/sla';

const NOTIFY_STATUSES = ['SENT', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED'] as const;

interface SettingsShape {
  'bot.greeting': string;
  'bot.handoffText': string;
  'notify.templates': Record<string, string>;
  sla: SlaConfig;
  'csat.question': string;
  'csat.thanks': string;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsShape>('/api/settings') });
  const [greeting, setGreeting] = useState('');
  const [handoff, setHandoff] = useState('');
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [sla, setSla] = useState<SlaConfig>({ enabled: true, queueWaitMinutes: 5, firstResponseMinutes: 10 });
  const [csatQuestion, setCsatQuestion] = useState('');
  const [csatThanks, setCsatThanks] = useState('');

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setGreeting(s['bot.greeting']);
    setHandoff(s['bot.handoffText']);
    setTemplates(s['notify.templates']);
    setSla(s.sla);
    setCsatQuestion(s['csat.question']);
    setCsatThanks(s['csat.thanks']);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      const put = (key: string, value: unknown) => api(`/api/settings/${key}`, { method: 'PUT', json: { value } });
      await put('bot.greeting', greeting);
      await put('bot.handoffText', handoff);
      await put('notify.templates', templates);
      await put('sla', sla);
      await put('csat.question', csatQuestion);
      await put('csat.thanks', csatThanks);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      message.success('บันทึกแล้ว');
    },
  });

  return (
    <>
      <PageHeader title="ตั้งค่าข้อความ & SLA">
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
                <Form.Item label="ข้อความเมื่อโอนให้เจ้าหน้าที่" style={{ marginBottom: 0 }}>
                  <Input.TextArea rows={2} value={handoff} onChange={(e) => setHandoff(e.target.value)} />
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
          <Col xs={24} lg={12}>
            <Card title="SLA · แจ้งเตือนแชตรอนาน" style={{ height: '100%' }}>
              <Flex align="center" gap={8} style={{ marginBottom: 16 }}>
                <Switch size="small" checked={sla.enabled} onChange={(v) => setSla({ ...sla, enabled: v })} />
                แสดงเวลารอและแจ้งเตือนเมื่อเกินกำหนด
              </Flex>
              <Form layout="vertical" disabled={!sla.enabled}>
                <Form.Item label="รอรับเรื่องในคิวได้ไม่เกิน" extra="นับจากที่แชตเข้าคิว จนมีคนรับเรื่อง">
                  <InputNumber
                    min={1}
                    max={1440}
                    suffix="นาที"
                    value={sla.queueWaitMinutes}
                    onChange={(v) => setSla({ ...sla, queueWaitMinutes: v ?? 1 })}
                  />
                </Form.Item>
                <Form.Item label="ตอบลูกค้าครั้งแรกภายใน" extra="นับจากที่แชตเข้าคิว จนเจ้าหน้าที่ตอบข้อความแรก" style={{ marginBottom: 0 }}>
                  <InputNumber
                    min={1}
                    max={1440}
                    suffix="นาที"
                    value={sla.firstResponseMinutes}
                    onChange={(v) => setSla({ ...sla, firstResponseMinutes: v ?? 1 })}
                  />
                </Form.Item>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="แบบประเมินความพึงพอใจ" style={{ height: '100%' }}>
              <Typography.Paragraph type="secondary">
                ส่งให้ลูกค้าเมื่อเจ้าหน้าที่ปิดเรื่อง เฉพาะ LINE OA ที่เปิด “ส่งแบบประเมินความพึงพอใจ” ไว้
              </Typography.Paragraph>
              <Form layout="vertical">
                <Form.Item label="คำถาม">
                  <Input.TextArea rows={2} maxLength={300} value={csatQuestion} onChange={(e) => setCsatQuestion(e.target.value)} />
                </Form.Item>
                <Form.Item label="ข้อความขอบคุณหลังให้คะแนน" style={{ marginBottom: 0 }}>
                  <Input.TextArea rows={2} maxLength={300} value={csatThanks} onChange={(e) => setCsatThanks(e.target.value)} />
                </Form.Item>
              </Form>
            </Card>
          </Col>
        </Row>
      </PageBody>
    </>
  );
}
