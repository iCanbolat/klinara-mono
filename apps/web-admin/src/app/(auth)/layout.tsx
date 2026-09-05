import type { ReactNode } from 'react';
import { KlinaraWordmark } from '@/components/brand/klinara-mark';

/**
 * Kimlik ekranlarının kabuğu — menü YOK, `SessionProvider` YOK.
 *
 * Henüz oturum olmadığı için `GET /me` çağıran bir sağlayıcıyı buraya koymak,
 * her giriş ekranında gereksiz bir 401 üretirdi.
 *
 * Düzen iOS `AuthScaffold`ın karşılığı: ortalanmış dar kolon, üstte marka.
 * Kartı KABUK değil her ekran kendisi çiziyor — bazıları (davet) kart yerine
 * tam genişlikte bir durum ekranı gösteriyor.
 */
export default function AuthLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6">
      <KlinaraWordmark markSize={36} />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
