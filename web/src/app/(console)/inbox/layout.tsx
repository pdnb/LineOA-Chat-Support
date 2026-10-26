'use client';

import { useParams } from 'next/navigation';
import { ReactNode } from 'react';
import styles from '@/components/chat.module.css';
import { ConversationList } from '@/components/inbox/ConversationList';

/** The list lives in the layout so its tab and search survive switching chats. */
export default function InboxLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  return (
    <div className={styles.inbox}>
      <ConversationList selectedId={id} />
      {children}
    </div>
  );
}
