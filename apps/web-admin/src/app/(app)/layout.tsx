import type { ReactNode } from 'react';
import { BranchProvider } from '@/components/session/branch-provider';
import { SessionProvider } from '@/components/session/session-provider';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
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
      <BranchProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2"
        >
          {t('nav.skipToContent')}
        </a>
        <SidebarProvider>
          <Sidebar />
          <SidebarInset>
            <Topbar />
            {/*
              Genişlik sınırı bilinçli: 24"lük bir ekranda tam genişlik bir tablo
              satırının gözle takip edilemeyeceği kadar uzun olur. İçerik dolgusu
              iOS `screenInset` (24) ile aynı.
            */}
            <main id="main" className="mx-auto w-full max-w-6xl flex-1 p-6 md:p-8">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </BranchProvider>
    </SessionProvider>
  );
}
