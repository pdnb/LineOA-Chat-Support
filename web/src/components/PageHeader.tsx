import { Flex, Typography } from 'antd';
import { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Flex
      wrap
      align="center"
      justify="space-between"
      gap={12}
      style={{ padding: '14px 24px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      <Typography.Title level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      <Flex wrap align="center" gap={8}>
        {children}
      </Flex>
    </Flex>
  );
}

/** Scrollable page body below a PageHeader. */
export function PageBody({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ padding: 'clamp(16px, 3vw, 24px)', ...style }}>{children}</div>
    </div>
  );
}
