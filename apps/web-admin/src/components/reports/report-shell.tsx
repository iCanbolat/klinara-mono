'use client';

import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n/tr';

/**
 * Rapor sayfalarının ortak kabuğu: başlık, hata, yükleniyor, kapsam rozeti.
 *
 * Beş sayfanın aynı dört durumu ayrı ayrı ele alması, dördünden birinin bir
 * sayfada unutulması demekti — en olası unutulan da boş durum.
 */

interface Props {
  title: string;
  description?: string | undefined;
  /** Sunucudan gelen kapsam; `own` ise rozet çıkıyor. */
  scope?: 'all' | 'own' | undefined;
  error: string | null;
  loading: boolean;
  /** Rapora özel uyarı (kohort notu, ciro kırılım notu). */
  note?: string | undefined;
  filters: ReactNode;
  children: ReactNode;
}

export function ReportShell({
  title,
  description,
  scope,
  error,
  loading,
  note,
  filters,
  children,
}: Props): ReactNode {
  return (
    <section>
      <PageHeader title={title} {...(description === undefined ? {} : { description })} />

      {/*
        Rozet SUNUCUNUN döndüğü `scope` alanından çiziliyor, istemcinin izin
        listesine bakıp çıkarım yapmasından değil. İki taraf kuralı ayrı ayrı
        yorumlasaydı, sunucu daraltırken istemci "tüm klinik" diye başlık atan
        bir rapor gösterebilirdi.
      */}
      {scope === 'own' ? (
        <Alert className="mb-4">{t('reports.scopeOwn')}</Alert>
      ) : null}

      {filters}

      {error === null ? null : (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      )}

      {note === undefined ? null : <p className="mb-3 text-xs text-muted-foreground">{note}</p>}

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-45 rounded-xl" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : (
        children
      )}
    </section>
  );
}
