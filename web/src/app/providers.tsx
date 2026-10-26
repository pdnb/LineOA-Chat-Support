'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import thTH from 'antd/locale/th_TH';
import { ReactNode, useState } from 'react';
import { AuthProvider } from '@/lib/auth';

const theme = {
  token: {
    colorPrimary: '#06c755',
    colorLink: '#04893a',
    borderRadius: 8,
    fontFamily: "var(--font-anuphan), ui-sans-serif, system-ui, sans-serif",
  },
};

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }),
  );
  return (
    <ConfigProvider locale={thTH} theme={theme}>
      <App style={{ height: '100%' }}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      </App>
    </ConfigProvider>
  );
}
