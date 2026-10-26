'use client';

import { Flex, Spin } from 'antd';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/lib/auth';

/** Signed-in area: redirects to /login without a session. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (!user) {
    return (
      <Flex align="center" justify="center" style={{ height: '100vh' }}>
        <Spin description="กำลังโหลด…" />
      </Flex>
    );
  }
  return <AppShell>{children}</AppShell>;
}
