'use client';

import { MessageOutlined } from '@ant-design/icons';
import { Empty } from 'antd';
import styles from '@/components/chat.module.css';

export default function InboxEmpty() {
  return (
    <div className={styles.emptyPane}>
      <Empty
        style={{ marginTop: '20vh' }}
        image={<MessageOutlined style={{ fontSize: 48, color: '#d1d5db' }} />}
        description={
          <>
            <div style={{ fontWeight: 500, color: 'var(--text)' }}>เลือกแชตเพื่อเริ่มตอบลูกค้า</div>
            <div>เรื่องที่ลูกค้าขอคุยกับเจ้าหน้าที่จะอยู่ในแท็บ “รอรับเรื่อง”</div>
          </>
        }
      />
    </div>
  );
}
