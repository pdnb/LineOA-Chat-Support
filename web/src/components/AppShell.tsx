'use client';

import {
  ApiOutlined,
  AuditOutlined,
  BarChartOutlined,
  CommentOutlined,
  DatabaseOutlined,
  LogoutOutlined,
  MessageOutlined,
  SettingOutlined,
  SolutionOutlined,
  TagsOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { App, Badge, Button, Flex, Grid, Layout, Menu, MenuProps, Tooltip, Typography } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setDesktopUnread } from '@/lib/desktop';
import { RealtimeAlert, useRealtime } from '@/lib/realtime';
import { Logo } from './Logo';
import { UserAvatar } from './UserAvatar';

const PresenceContext = createContext<string[]>([]);
export const useOnline = () => useContext(PresenceContext);

const SIDER_WIDTH = 232;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { notification } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const onAlert = (a: RealtimeAlert) => {
    const open = () => {
      if (a.conversationId) router.push(`/inbox/${a.conversationId}`);
      else if (a.kind === 'queue') router.push('/admin/queue');
    };
    const notice = { title: a.title, description: a.body, onClick: open, style: { cursor: 'pointer' }, duration: 8 };
    if (a.kind === 'queue') notification.error(notice);
    else if (a.kind === 'sla') notification.warning(notice);
    else notification.info(notice);
  };
  const { online, connected } = useRealtime(!!user, onAlert);
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
  const failedTasks = useQuery({
    queryKey: ['queue-tasks', 'failed-count'],
    queryFn: () => api<{ total: number }>('/api/queue-tasks?status=FAILED&take=1'),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });
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
              { key: '/admin/canned-replies', icon: <ThunderboltOutlined />, label: link('/admin/canned-replies', 'ข้อความสำเร็จรูป') },
              { key: '/admin/settings', icon: <SettingOutlined />, label: link('/admin/settings', 'ตั้งค่าข้อความ & SLA') },
              {
                key: '/admin/queue',
                icon: <DatabaseOutlined />,
                label: link(
                  '/admin/queue',
                  <Flex justify="space-between" align="center">
                    งานค้างในคิว
                    <Badge count={failedTasks.data?.total} size="small" />
                  </Flex>,
                ),
              },
              { key: '/admin/audit-log', icon: <AuditOutlined />, label: link('/admin/audit-log', 'บันทึกการใช้งาน') },
            ],
          },
        ] satisfies MenuProps['items'])
      : []),
  ];
  const keys = items.flatMap((i) => (i && 'children' in i && i.children ? i.children : [i])).map((i) => String(i?.key));
  const selected = keys.find((k) => pathname === k || pathname.startsWith(k + '/'));

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
