import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/session/session-provider';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { t } from '@/i18n/tr';

/**
 * Panel kabuğu.
 *
 * ⚠️ BU BİR SUNUCU BİLEŞENİ VE API'YE HİÇ GİTMİYOR. Next 15'te `cookies().set()`
 * RSC içinde fırlıyor; yetkili bir çağrı her an yenileme gerektirebileceği için
 * buradan yapılamaz. Veri `SessionProvider` tarafından, tarayıcıdan,
 * `/api/session/me` üzerinden çekiliyor.
 */
export default function AppLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <SessionProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-card focus:px-3 focus:py-2"
      >
        {t('nav.skipToContent')}
      </a>
      <div className="flex min-h-screen flex-col">
        <Topbar />
        <div className="flex flex-1">
          <Sidebar />
          <main id="main" className="flex-1 p-6">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
