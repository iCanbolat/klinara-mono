import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ApiReadError, fetchSite } from '@/lib/api-server';
import { themeStyleSheet } from '@/lib/theme';
import { LocaleProvider } from '@/i18n/locale-provider';

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const site = await loadSite(slug);

  const title = site.seo.title ?? site.name;
  const description = site.seo.description ?? undefined;
  const ogImage = site.seo.ogImage?.url;

  return {
    title,
    ...(description === undefined ? {} : { description }),
    // Kanonik adres SUNUCUDAN geliyor (`is_primary` alan adı), istemcide
    // konak adından türetilmiyor: ziyaretçinin geldiği adres kanonik olan
    // olmayabilir ve aynı içeriğin iki adresten indekslenmesi arama
    // sonuçlarını kendi kendine böler.
    ...(site.canonicalUrl === '' ? {} : { alternates: { canonical: site.canonicalUrl } }),
    openGraph: {
      title,
      ...(description === undefined ? {} : { description }),
      type: 'website',
      ...(ogImage === undefined ? {} : { images: [{ url: ogImage }] }),
    },
  };
}

export default async function SiteLayout({ children, params }: Params & { children: ReactNode }) {
  const { slug } = await params;
  const site = await loadSite(slug);

  return (
    <LocaleProvider locale={site.locales[0] ?? 'tr'}>
      {/* Tema `:root` değişkenlerine yazılıyor; Tailwind sınıfları onları okuyor. */}
      <style dangerouslySetInnerHTML={{ __html: themeStyleSheet(site.theme) }} />
      {children}
    </LocaleProvider>
  );
}

async function loadSite(slug: string) {
  try {
    return await fetchSite(slug);
  } catch (error) {
    if (error instanceof ApiReadError && error.status === 404) notFound();
    throw error;
  }
}
