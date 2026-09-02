import type { ReactNode } from 'react';
import './globals.css';

/**
 * Favicon LİTERAL bir rotadan (`app/icon.svg/route.ts`) geliyor.
 *
 * Kök seviyedeki `[slug]` dinamik segmenti hem App Router'ın kök metadata
 * rotalarını (`icon`, `robots`) hem de `public/` altındaki dosyaları
 * yutuyordu: `/robots.txt` isteği slug'ı "robots.txt" sanılıp API'ye gidiyor
 * ve 404'e düşüyordu. Literal segment dinamik olandan önce eşleşiyor.
 */
export const metadata = {
  icons: { icon: '/icon.svg' },
};

/**
 * Kök layout — kasıtlı olarak minimum.
 *
 * `<html>`/`<body>` burada duruyor; tema `[slug]` layout'unda `<style>` ile
 * eziliyor. `lang` SABİT `tr`: kiracıya göre değiştirmek `headers()` okumayı
 * gerektirir ve bu, TÜM ağacı dinamik render'a düşürüp 11.1'in ISR ve LCP
 * hedefini bozar. Sözlükte tek dil (`tr`) varken bu takas doğru; ikinci dil
 * geldiğinde çözüm `app/[locale]/[slug]` rota grubudur, `headers()` değil.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
