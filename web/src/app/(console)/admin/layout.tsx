'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) router.replace('/inbox');
  }, [isAdmin, router]);

  return isAdmin ? children : null;
}
