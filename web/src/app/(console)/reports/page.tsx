'use client';

import { DownloadOutlined, StarFilled } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Card, Col, Dropdown, Empty, Flex, Progress, Row, Select, Spin, Statistic, Table, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ToneTag } from '@/components/StatusTag';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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
  csat: { avg: number | null; rated: number; sent: number; distribution: Record<string, number> };
}

interface AgentRow {
  userId: string;
  name: string;
  isActive: boolean;
  handled: number;
  messagesSent: number;
  resolved: number;
  avgFirstResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
  csatAvg: number | null;
  csatCount: number;
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
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin = user?.role === 'ADMIN';
  const agents = useQuery({
    queryKey: ['report-agents', days],
    queryFn: () => api<{ agents: AgentRow[] }>(`/api/reports/agents?days=${days}`),
  });
  const exportCsv = useMutation({
    mutationFn: (type: string) => download(`/api/reports/export?type=${type}&days=${days}`, `${type}.csv`),
    onError: (err) => message.error(err instanceof Error ? err.message : 'ดาวน์โหลดไม่สำเร็จ'),
  });
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
        {isAdmin && (
          <Dropdown
            trigger={['click']}
            menu={{
              onClick: ({ key }) => exportCsv.mutate(key),
              items: [
                { key: 'conversations', label: 'แชต (CSV)' },
                { key: 'jobs', label: 'งาน (CSV)' },
                { key: 'agents', label: 'ประสิทธิภาพเจ้าหน้าที่ (CSV)' },
              ],
            }}
          >
            <Button icon={<DownloadOutlined />} loading={exportCsv.isPending}>
              Export CSV
            </Button>
          </Dropdown>
        )}
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
                <Stat
                  label="ความพึงพอใจเฉลี่ย"
                  value={data.csat.avg == null ? '-' : `${data.csat.avg.toFixed(2)} / 5`}
                  sub={
                    data.csat.sent
                      ? `ตอบ ${data.csat.rated} จาก ${data.csat.sent} แบบประเมิน · ส่งงานไม่สำเร็จ ${data.jobsByStatus.FAILED ?? 0}`
                      : `ส่งงานไม่สำเร็จ ${data.jobsByStatus.FAILED ?? 0}`
                  }
                />
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
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={16}>
                <Card title={isAdmin ? 'ประสิทธิภาพรายเจ้าหน้าที่' : 'ผลงานของฉัน'} style={{ height: '100%' }}>
                  <Table<AgentRow>
                    rowKey="userId"
                    size="small"
                    loading={agents.isLoading}
                    dataSource={agents.data?.agents}
                    pagination={false}
                    scroll={{ x: 640 }}
                    columns={[
                      {
                        title: 'เจ้าหน้าที่',
                        render: (_, a) => (
                          <>
                            {a.name} {!a.isActive && <ToneTag tone="red">ปิดใช้งาน</ToneTag>}
                          </>
                        ),
                      },
                      { title: 'แชตที่ดูแล', dataIndex: 'handled', align: 'right', sorter: (a, b) => a.handled - b.handled },
                      { title: 'ปิดเรื่อง', dataIndex: 'resolved', align: 'right', sorter: (a, b) => a.resolved - b.resolved },
                      {
                        title: 'ตอบครั้งแรกเฉลี่ย',
                        dataIndex: 'avgFirstResponseSeconds',
                        align: 'right',
                        render: fmtDuration,
                        sorter: (a, b) => (a.avgFirstResponseSeconds ?? Infinity) - (b.avgFirstResponseSeconds ?? Infinity),
                      },
                      {
                        title: 'เวลาจนปิดเรื่องเฉลี่ย',
                        dataIndex: 'avgResolutionSeconds',
                        align: 'right',
                        render: fmtDuration,
                        sorter: (a, b) => (a.avgResolutionSeconds ?? Infinity) - (b.avgResolutionSeconds ?? Infinity),
                      },
                      {
                        title: 'ความพึงพอใจ',
                        align: 'right',
                        render: (_, a) =>
                          a.csatAvg == null ? '-' : (
                            <Tooltip title={`จาก ${a.csatCount} คะแนน`}>
                              <StarFilled style={{ color: '#ca8a04' }} /> {a.csatAvg.toFixed(2)}
                            </Tooltip>
                          ),
                        sorter: (a, b) => (a.csatAvg ?? 0) - (b.csatAvg ?? 0),
                      },
                    ]}
                  />
                </Card>
              </Col>
              <Col xs={24} lg={8}>
                <Card title="คะแนนความพึงพอใจ" style={{ height: '100%' }}>
                  {data.csat.rated ? (
                    <Bars rows={[5, 4, 3, 2, 1].map((r) => ({ label: `${'★'.repeat(r)}`, value: data.csat.distribution[r] ?? 0 }))} />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีคะแนน — เปิดได้ที่หน้าบัญชี LINE OA" />
                  )}
                </Card>
              </Col>
            </Row>
          </Flex>
        )}
      </PageBody>
    </>
  );
}
