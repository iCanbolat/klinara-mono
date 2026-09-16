import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Önizleme rotası arama motorlarına KAPALI.
 *
 * `middleware.ts`teki `robots.txt` de bu yolu yasaklıyor; ikisi birden var
 * çünkü `Disallow` bir rica, `noindex` bir talimattır ve taslak içeriğin
 * indekslenmesi kiracı için gerçek bir zarar olurdu.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: ReactNode }): ReactNode {
  return <>{children}</>;
}
