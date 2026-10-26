import { EnvironmentOutlined, FileTextOutlined, RobotOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import { fmtTime } from '@/lib/format';
import { Message } from '@/lib/types';
import styles from './chat.module.css';

function Body({ m }: { m: Message }) {
  const p = m.payload ?? {};
  switch (m.type) {
    case 'image':
      return p.url ? (
        <a href={p.url} target="_blank" rel="noreferrer">
          <img src={p.url} alt="รูปภาพ" className={styles.media} />
        </a>
      ) : (
        <span style={{ fontStyle: 'italic', opacity: 0.7 }}>[รูปภาพ — ดาวน์โหลดไม่สำเร็จ]</span>
      );
    case 'sticker':
      return (
        <img
          src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${p.stickerId}/android/sticker.png`}
          alt="สติกเกอร์"
          style={{ width: 96, height: 96, objectFit: 'contain' }}
        />
      );
    case 'video':
      return p.url ? <video src={p.url} controls className={styles.media} /> : <span>[วิดีโอ]</span>;
    case 'audio':
      return p.url ? <audio src={p.url} controls /> : <span>[เสียง]</span>;
    case 'file':
      return (
        <a href={p.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
          <FileTextOutlined /> {p.fileName ?? 'ไฟล์แนบ'}
        </a>
      );
    case 'location':
      return (
        <a
          href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: 'underline' }}
        >
          <EnvironmentOutlined /> {m.text ?? 'ตำแหน่ง'}
        </a>
      );
    case 'flex':
      return (
        <div className={styles.flexCard}>
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>การ์ดแจ้งสถานะ</div>
          {m.text}
        </div>
      );
    default:
      return <span>{m.text ?? `[${m.type}]`}</span>;
  }
}

export function MessageBubble({ m }: { m: Message }) {
  if (m.senderType === 'SYSTEM') {
    return (
      <div className={styles.system}>
        {m.text} · {fmtTime(m.createdAt)}
      </div>
    );
  }
  const mine = m.direction === 'OUT';
  const bot = m.senderType === 'BOT';
  const media = ['image', 'sticker', 'video'].includes(m.type);
  const quickReplies: string[] = (m.payload?.quickReply?.items ?? []).map((i: any) => i.action?.label);

  return (
    <div className={styles.msg} data-mine={mine}>
      {mine && (
        <span className={styles.sender}>
          {bot ? (
            <>
              <RobotOutlined /> Bot
            </>
          ) : (
            m.senderUser?.name
          )}
        </span>
      )}
      <div className={styles.bubble} data-kind={!mine ? 'customer' : bot ? 'bot' : 'agent'} data-media={media}>
        <Body m={m} />
      </div>
      {quickReplies.length > 0 && (
        <div className={styles.quickReplies}>
          {quickReplies.map((label, i) => (
            <Tag key={i} variant="outlined" style={{ marginInlineEnd: 0, borderRadius: 999 }}>
              {label}
            </Tag>
          ))}
        </div>
      )}
      <span className={styles.time}>{fmtTime(m.createdAt)}</span>
    </div>
  );
}
