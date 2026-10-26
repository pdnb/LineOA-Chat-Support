'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from './api';
import { Message } from './types';

/** Connects to the inbox socket and keeps React Query caches fresh. Returns online user ids. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  const [online, setOnline] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const socket = io('/inbox', { auth: { token: getToken() }, transports: ['websocket'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('presence', setOnline);
    socket.on('message.created', (m: Message) => {
      qc.invalidateQueries({ queryKey: ['conversation', m.conversationId] });
      if (m.direction === 'IN' && document.hidden) notify(m.text ?? 'ข้อความใหม่');
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
    return () => {
      socket.disconnect();
    };
  }, [enabled, qc]);

  return { online, connected };
}

function notify(body: string) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification('ข้อความใหม่จาก LINE', { body });
}
