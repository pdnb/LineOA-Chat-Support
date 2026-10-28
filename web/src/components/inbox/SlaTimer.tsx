'use client';

import { ClockCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Tag, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { SlaConfig, slaClock, SlaLevel } from '@/lib/sla';
import { Conversation } from '@/lib/types';

const COLOR: Record<SlaLevel, string> = { ok: 'green', warn: 'gold', breach: 'red' };

/** Re-renders every `ms` so elapsed times tick. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useSlaConfig() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Record<string, unknown>>('/api/settings'), staleTime: 60_000 });
  return settings.data?.sla as SlaConfig | undefined;
}

function minutes(ms: number) {
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
}

/** Waiting time of a queued chat, or time without a first answer of an assigned one, colored by SLA. */
export function SlaTimer({ conv, cfg }: { conv: Conversation; cfg: SlaConfig | undefined }) {
  const now = useNow(15_000);
  const clock = slaClock(conv, cfg, now);
  if (!clock) return null;
  const label = clock.kind === 'queue' ? `รอ ${minutes(clock.elapsedMs)}` : `ยังไม่ตอบ ${minutes(clock.elapsedMs)}`;
  const limit = clock.kind === 'queue' ? 'เวลารอรับเรื่อง' : 'เวลาตอบครั้งแรก';
  return (
    <Tooltip title={`${limit}ไม่เกิน ${minutes(clock.limitMs)}`}>
      <Tag color={COLOR[clock.level]} icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0 }}>
        {label}
      </Tag>
    </Tooltip>
  );
}
