'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { BranchDetail } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { useBranch } from '@/components/session/branch-provider';
import { Alert } from '@/components/ui/alert';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Klinik konumu: seçili şubenin adresi.
 *
 * Mesajlarda adres `@KlinikAdresi` olarak, harita ise "Haritada aç" butonuyla
 * gider; buton adresten üretilir (Meta URL butonunda alan adı sabit, yalnız
 * sonu değişken). Bu yüzden burada bağlantı girilmiyor — düzenlenecek tek şey
 * şubenin adresi ve o "Şube ve Personel" ekranında.
 */
export function LocationCard(): ReactNode {
  const { branchId } = useBranch();

  /** `undefined` = yükleniyor, `null` = şube listede yok. */
  const [branch, setBranch] = useState<BranchDetail | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (branchId === null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = await api.get<{ data: BranchDetail[] }>('branches', {
          signal: controller.signal,
        });
        setBranch(data.find((item) => item.id === branchId) ?? null);
        setLoadError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setLoadError(toMessage(caught));
        setBranch(null);
      }
    })();
    return () => controller.abort();
  }, [branchId]);

  if (branchId === null) {
    return (
      <Card>
        <CardTitle>{t('templates.location.title')}</CardTitle>
        <p className="mt-2 text-sm text-muted-foreground">{t('templates.location.pickBranch')}</p>
      </Card>
    );
  }
  if (branch === undefined) return <Skeleton className="h-32 w-full rounded-xl" />;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('templates.location.title')}</CardTitle>
          <CardDescription>{t('templates.location.description')}</CardDescription>
        </div>
      </CardHeader>
      {loadError !== null ? <Alert tone="danger">{loadError}</Alert> : null}
      {branch === null ? null : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('templates.location.branch')}</dt>
            <dd className="font-medium text-foreground">{branch.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('templates.location.address')}</dt>
            <dd className="font-medium text-foreground">
              {branch.address !== null && branch.address !== ''
                ? branch.address
                : t('templates.location.noAddress')}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
