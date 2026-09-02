import { notFound } from 'next/navigation';

export const dynamic = 'force-static';

export const metadata = {
  title: 'Sayfa bulunamadı',
  robots: { index: false, follow: false },
};

/**
 * Bilinmeyen konak adının indiği rota.
 *
 * Segment adındaki nokta KASITLI: slug deseni (`^[a-z0-9][a-z0-9-]{0,62}$`)
 * nokta kabul etmiyor, yani hiçbir kiracının sayfası bu literal rotayla
 * gölgelenemez. (`_` önekli bir klasör App Router'da hiç rota olmuyordu.)
 *
 * Gövde `not-found.tsx`te: `rewrite` durum kodunu DEĞİŞTİRMEZ, yani bu sayfa
 * içeriği kendi bassaydı arama motorları ve izleme araçları "sayfa bulunamadı"
 * metnini `200` ile görürdü. `notFound()` hem doğru durumu hem aynı ekranı
 * veriyor.
 */
export default function UnknownHostPage(): never {
  notFound();
}
