import type { ReactNode } from 'react';

/**
 * Locale taşıyıcısı.
 *
 * Bugün tek değer (`tr`) taşıyor ve hiçbir şeyi dallandırmıyor; var olma
 * sebebi API'nin `locales` alanının sayfaya kadar ULAŞTIĞINI göstermek ve
 * ikinci dil geldiğinde eklenecek yerin belli olması. Sunucu bileşeni olarak
 * duruyor — context'e çevirmek tüm ağacı istemciye taşırdı.
 */
export function LocaleProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return <div data-locale={locale}>{children}</div>;
}
