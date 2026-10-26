import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata } from 'next';
import { Anuphan } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const anuphan = Anuphan({ subsets: ['thai', 'latin'], weight: ['400', '500', '600', '700'], variable: '--font-anuphan' });

export const metadata: Metadata = { title: 'CC LineOA Support' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={anuphan.variable}>
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
