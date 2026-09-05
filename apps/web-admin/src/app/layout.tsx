import type { Metadata } from 'next';
import { Manrope, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { t } from '@/i18n/tr';
import './globals.css';

/*
 * iOS ile AYNI iki aile: gövde Manrope, başlık Source Serif 4
 * (bkz. `klinara-ios/klinara-ios/DesignSystem/KlinaraFont.swift`).
 *
 * `latin-ext` şart: Türkçe'nin ş/ğ/İ/ı karakterleri `latin` altkümesinde yok ve
 * eksik olduğunda tarayıcı o harfleri yedek fonttan çizip kelimeyi ikiye böler.
 */
const manrope = Manrope({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-manrope',
  display: 'swap',
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '600'],
  variable: '--font-source-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: t('app.title'),
  // Yönetim paneli hiçbir arama motorunda görünmemeli.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="tr" className={`${manrope.variable} ${sourceSerif.variable}`}>
      <body className="font-sans antialiased">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
