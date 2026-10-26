'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, Col, Empty, Flex, Progress, Row, Select, Spin, Statistic, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { CONVERSATION_STATUS, fmtDuration, JOB_STATUS } from '@/lib/format';
import { ConversationStatus, JobStatus } from '@/lib/types';

interface Summary {
  days: number;
  conversationsByStatus: Partial<Record<ConversationStatus, number>>;
  jobsByStatus: Partial<Record<JobStatus, number>>;
  jobsByCategory: { name: string; count: number }[];
  avgFirstResponseSeconds: number | null;
  handledConversations: number;
  daily: { day: string; conversations: number; jobs: number }[];
}

const sum = (o: Record<string, number | undefined>) => Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card style={{ height: '100%' }}>
      <Statistic title={label} value={value} />
      {sub && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {sub}
        </Typography.Text>
      )}
    </Card>
  );
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Flex vertical gap={8}>
      {rows.map((r) => (
        <Flex key={r.label} align="center" gap={12}>
          <Typography.Text type="secondary" ellipsis style={{ width: 128, flexShrink: 0 }}>
            {r.label}
          </Typography.Text>
          <Progress
            percent={(r.value / max) * 100}
            showInfo={false}
            strokeColor="var(--brand)"
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
        </Flex>
      ))}
    </Flex>
  );
}

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({
    queryKey: ['report', days],
    queryFn: () => api<Summary>(`/api/reports/summary?days=${days}`),
  });
  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((d) => d.conversations));

  return (
    <>
      <PageHeader title="รายงาน">
        <Select
          style={{ width: 160 }}
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: '7 วันล่าสุด' },
            { value: 30, label: '30 วันล่าสุด' },
            { value: 90, label: '90 วันล่าสุด' },
          ]}
        />
      </PageHeader>
      <PageBody>
        {isLoading && (
          <Flex justify="center" style={{ padding: 48 }}>
            <Spin />
          </Flex>
        )}
        {data && (
          <Flex vertical gap={24}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <Stat label="แชตทั้งหมด" value={sum(data.conversationsByStatus)} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Stat label="งานที่สร้าง" value={sum(data.jobsByStatus)} sub={`เสร็จสิ้น ${data.jobsByStatus.DONE ?? 0}`} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Stat
                  label="เวลาตอบครั้งแรกเฉลี่ย"
                  value={fmtDuration(data.avgFirstResponseSeconds)}
                  sub={`จาก ${data.handledConversations} แชตที่เจ้าหน้าที่ตอบ`}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Stat label="ส่งงานไม่สำเร็จ" value={data.jobsByStatus.FAILED ?? 0} />
              </Col>
            </Row>

            <Card title="แชตรายวัน">
              <Flex align="flex-end" gap={2} style={{ height: 144 }} role="img" aria-label="กราฟแชตรายวัน">
                {data.daily.map((d) => (
                  <Tooltip key={d.day} title={`${d.day}: ${d.conversations} แชต, ${d.jobs} งาน`}>
                    <div
                      style={{
                        flex: 1,
                        height: `${Math.max(2, (d.conversations / maxDaily) * 100)}%`,
                        background: 'var(--brand)',
                        opacity: 0.85,
                        borderRadius: '3px 3px 0 0',
                      }}
                    />
                  </Tooltip>
                ))}
              </Flex>
              <Flex justify="space-between" style={{ marginTop: 4 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {data.daily[0]?.day}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {data.daily[data.daily.length - 1]?.day}
                </Typography.Text>
              </Flex>
            </Card>

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={8}>
                <Card title="งานตามสถานะ" style={{ height: '100%' }}>
                  <Bars
                    rows={(Object.keys(JOB_STATUS) as JobStatus[]).map((s) => ({
                      label: JOB_STATUS[s].label,
                      value: data.jobsByStatus[s] ?? 0,
                    }))}
                  />
                </Card>
              </Col>
              <Col xs={24} lg={8}>
                <Card title="งานตามหมวด" style={{ height: '100%' }}>
                  {data.jobsByCategory.length ? (
                    <Bars rows={data.jobsByCategory.map((r) => ({ label: r.name, value: r.count }))} />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีข้อมูล" />
                  )}
                </Card>
              </Col>
              <Col xs={24} lg={8}>
                <Card title="แชตตามสถานะ" style={{ height: '100%' }}>
                  <Bars
                    rows={(Object.keys(CONVERSATION_STATUS) as ConversationStatus[]).map((s) => ({
                      label: CONVERSATION_STATUS[s].label,
                      value: data.conversationsByStatus[s] ?? 0,
                    }))}
                  />
                </Card>
              </Col>
            </Row>
          </Flex>
        )}
      </PageBody>
    </>
  );
}
