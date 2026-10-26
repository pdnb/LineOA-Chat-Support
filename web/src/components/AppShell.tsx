'use client';

import {
  ApiOutlined,
  BarChartOutlined,
  CommentOutlined,
  LogoutOutlined,
  MessageOutlined,
  SettingOutlined,
  SolutionOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Flex, Grid, Layout, Menu, MenuProps, Tooltip, Typography } from 'antd';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setDesktopUnread } from '@/lib/desktop';
import { useRealtime } from '@/lib/realtime';
import { Logo } from './Logo';
import { UserAvatar } from './UserAvatar';

const PresenceContext = createContext<string[]>([]);
export const useOnline = () => useContext(PresenceContext);

const SIDER_WIDTH = 232;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const { online, connected } = useRealtime(!!user);
  const counts = useQuery({
    queryKey: ['counts'],
    queryFn: () => api<{ queue: number; mine: number }>('/api/conversations/counts'),
    refetchInterval: 30_000,
  });
  const queue = counts.data?.queue;
  useEffect(() => {
    if (queue !== undefined) setDesktopUnread(queue);
  }, [queue]);
  // Logging out unmounts the shell: clear the taskbar badge.
  useEffect(() => () => setDesktopUnread(0), []);
  const isAdmin = user?.role === 'ADMIN';
  const mobile = screens.md === false;

  const link = (href: string, label: ReactNode) => (
    <Link href={href} onClick={() => mobile && setCollapsed(true)}>
      {label}
    </Link>
  );
  const items: MenuProps['items'] = [
    {
      key: '/inbox',
      icon: <MessageOutlined />,
      label: link(
        '/inbox',
        <Flex justify="space-between" align="center">
          กล่องแชต
          <Badge count={counts.data?.queue} color="#f59e0b" size="small" />
        </Flex>,
      ),
    },
    { key: '/jobs', icon: <SolutionOutlined />, label: link('/jobs', 'งาน (Jobs)') },
    { key: '/reports', icon: <BarChartOutlined />, label: link('/reports', 'รายงาน') },
    ...(isAdmin
      ? ([
          {
            type: 'group',
            label: 'ผู้ดูแลระบบ',
            children: [
              { key: '/admin/line-channels', icon: <CommentOutlined />, label: link('/admin/line-channels', 'บัญชี LINE OA') },
              { key: '/admin/categories', icon: <TagsOutlined />, label: link('/admin/categories', 'หมวดเรื่อง & Bot') },
              { key: '/admin/integrations', icon: <ApiOutlined />, label: link('/admin/integrations', 'ระบบปลายทาง') },
              { key: '/admin/users', icon: <TeamOutlined />, label: link('/admin/users', 'เจ้าหน้าที่') },
              { key: '/admin/settings', icon: <SettingOutlined />, label: link('/admin/settings', 'ตั้งค่าข้อความ') },
            ],
          },
        ] satisfies MenuProps['items'])
      : []),
  ];
  const selected = ['/inbox', '/jobs', '/reports', '/admin/line-channels', '/admin/categories', '/admin/integrations', '/admin/users', '/admin/settings'].find(
    (k) => pathname === k || pathname.startsWith(k + '/'),
  );

  return (
    <PresenceContext.Provider value={online}>
      <Layout style={{ height: '100vh' }}>
        <Layout.Sider
          theme="light"
          width={SIDER_WIDTH}
          breakpoint="md"
          collapsedWidth={0}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          style={{
            borderRight: '1px solid var(--border)',
            ...(mobile ? { position: 'fixed', insetBlock: 0, zIndex: 100, boxShadow: collapsed ? 'none' : '0 0 24px rgba(0,0,0,.15)' } : {}),
          }}
          zeroWidthTriggerStyle={{ top: 10, zIndex: 101 }}
        >
          <Flex vertical style={{ height: '100%' }}>
            <Flex align="center" gap={10} style={{ padding: 16 }}>
              <Logo size={32} />
              <div style={{ fontWeight: 600 }}>Hotline</div>
            </Flex>
            <Menu
              mode="inline"
              items={items}
              selectedKeys={selected ? [selected] : []}
              style={{ flex: 1, borderInlineEnd: 'none', overflowY: 'auto' }}
            />
            <Flex align="center" gap={8} style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
              <Tooltip title={connected ? 'เชื่อมต่อแบบเรียลไทม์' : 'ไม่ได้เชื่อมต่อ'}>
                <Badge dot color={connected ? 'var(--brand)' : '#d1d5db'} offset={[-4, 28]}>
                  <UserAvatar name={user?.name} size={32} />
                </Badge>
              </Tooltip>
              <div style={{ minWidth: 0, flex: 1, lineHeight: 1.3 }}>
                <Typography.Text strong ellipsis style={{ display: 'block' }}>
                  {user?.name}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {isAdmin ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่'}
                </Typography.Text>
              </div>
              <Tooltip title="ออกจากระบบ">
                <Button type="text" icon={<LogoutOutlined />} onClick={logout} aria-label="ออกจากระบบ" />
              </Tooltip>
            </Flex>
          </Flex>
        </Layout.Sider>
        <Layout.Content style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>{children}</Layout.Content>
      </Layout>
    </PresenceContext.Provider>
  );
}
