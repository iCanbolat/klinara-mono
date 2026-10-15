import type { ReactNode } from 'react';
import { KlinaraWordmark } from '@/components/brand/klinara-mark';
import { PlatformSignOut } from '@/components/platform/platform-sign-out';

export const metadata = { title: 'Klinara Platform' };

/**
 * Platform yöneticisi kabuğu — klinik panelinin menüsü ve `SessionProvider`ı
 * YOK. Bu ekranlar klinik oturumundan bağımsız (`lib/platform-session.ts`).
 */
export default function PlatformLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <KlinaraWordmark markSize={28} />
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Platform
          </span>
        </div>
        <PlatformSignOut />
      </header>
      <main className="mx-auto w-full max-w-6xl p-6">{children}</main>
    </div>
  );
}
