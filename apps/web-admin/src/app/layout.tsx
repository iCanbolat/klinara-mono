import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { t } from '@/i18n/tr';
import './globals.css';

export const metadata: Metadata = {
  title: t('app.title'),
  // Yönetim paneli hiçbir arama motorunda görünmemeli.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
