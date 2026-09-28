import type { ReactNode } from 'react';
import { BranchProvider } from '@/components/session/branch-provider';
import { SessionProvider } from '@/components/session/session-provider';

/**
 * İmza modu kabuğu — panel menüsü ve üst çubuğu YOK.
 *
 * Tablet hastanın elindeyken ekranda başka bir sayfaya giden tek bir bağlantı
 * bile olmamalı: hasta yanlışlıkla müşteri listesine, başka bir hastanın
 * kartına düşebilirdi. Oturum yine personelin oturumu; koruma rota
 * düzeyinde (`middleware.ts`) ve API'de değişmeden geçerli.
 */
export default function SigningLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <SessionProvider>
      <BranchProvider>
        <main className="min-h-dvh bg-background">{children}</main>
      </BranchProvider>
    </SessionProvider>
  );
}
