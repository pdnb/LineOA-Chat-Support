'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from './api';
import { desktopNotify, isDesktop } from './desktop';
import { Message } from './types';

/** Something an agent should act on now; the shell shows it as a notification. */
export interface RealtimeAlert {
  kind: 'sla' | 'transfer' | 'queue';
  title: string;
  body: string;
  conversationId?: string;
}

interface SlaBreached {
  conversationId: string;
  kind: 'queue' | 'response';
  minutes: number;
  contactName: string | null;
}

interface Transferred {
  conversationId: string;
  from: string;
  note: string | null;
  contactName: string | null;
}

/** Connects to the inbox socket and keeps React Query caches fresh. Returns online user ids. */
export function useRealtime(enabled: boolean, onAlert?: (alert: RealtimeAlert) => void) {
  const qc = useQueryClient();
  const [online, setOnline] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const alertRef = useRef(onAlert);
  alertRef.current = onAlert;

  useEffect(() => {
    if (!enabled) return;
    const socket = io('/inbox', { auth: { token: getToken() }, transports: ['websocket'] });
    /** In-app notice plus a desktop toast / browser notification when the agent isn't looking. */
    const alert = (a: RealtimeAlert) => {
      alertRef.current?.(a);
      if (isDesktop() && a.conversationId) desktopNotify(a.title, a.body, a.conversationId);
      else if (document.hidden) notify(a.title, a.body);
    };

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('presence', setOnline);
    socket.on('message.created', (m: Message) => {
      qc.invalidateQueries({ queryKey: ['conversation', m.conversationId] });
      // The desktop app decides itself (document.hidden isn't reliable once the window is hidden to the tray).
      if (m.direction === 'IN' && isDesktop()) desktopNotify('ข้อความใหม่จาก LINE', m.text ?? 'ข้อความใหม่', m.conversationId);
      else if (m.direction === 'IN' && document.hidden) notify('ข้อความใหม่จาก LINE', m.text ?? 'ข้อความใหม่');
    });
    socket.on('conversation.updated', () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
    });
    socket.on('job.updated', (job: { id: string; contactId: string }) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['job', job.id] });
      qc.invalidateQueries({ queryKey: ['contact', job.contactId] });
    });
    socket.on('sla.breached', (e: SlaBreached) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      const who = e.contactName ?? 'ลูกค้า';
      alert({
        kind: 'sla',
        title: 'แชตรอนานเกินกำหนด',
        body: e.kind === 'queue' ? `${who} รอรับเรื่อง ${e.minutes} นาที` : `${who} ยังไม่ได้รับคำตอบ ${e.minutes} นาที`,
        conversationId: e.conversationId,
      });
    });
    socket.on('conversation.transferred', (e: Transferred) => {
      alert({
        kind: 'transfer',
        title: 'มีแชตโอนถึงคุณ',
        body: `${e.from} โอน ${e.contactName ?? 'แชต'} ให้คุณ${e.note ? `: ${e.note}` : ''}`,
        conversationId: e.conversationId,
      });
    });
    socket.on('queue.failed', (e: { queue: string; error: string }) => {
      qc.invalidateQueries({ queryKey: ['queue-tasks'] });
      alertRef.current?.({ kind: 'queue', title: 'งานในคิวล้มเหลว', body: `${e.queue}: ${e.error}` });
    });
    return () => {
      socket.disconnect();
    };
  }, [enabled, qc]);

  return { online, connected };
}

function notify(title: string, body: string) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification(title, { body });
}
