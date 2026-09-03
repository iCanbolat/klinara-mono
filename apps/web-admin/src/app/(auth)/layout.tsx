import type { ReactNode } from 'react';

/**
 * Kimlik ekranlarının kabuğu — menü YOK, `SessionProvider` YOK.
 *
 * Henüz oturum olmadığı için `GET /me` çağıran bir sağlayıcıyı buraya koymak,
 * her giriş ekranında gereksiz bir 401 üretirdi.
 */
export default function AuthLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
