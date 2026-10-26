import { Avatar } from 'antd';

/** Profile picture, or the first letter of the name on a brand-tinted circle. */
export function UserAvatar({ name, src, size = 36 }: { name?: string | null; src?: string | null; size?: number }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase();
  return src ? (
    <Avatar src={src} size={size} style={{ flexShrink: 0 }} />
  ) : (
    <Avatar size={size} style={{ flexShrink: 0, background: '#c9f4da', color: 'var(--brand-dark)', fontWeight: 600 }}>
      {initial}
    </Avatar>
  );
}
