'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PERMISSIONS, SETTINGS_LIMITS, type BookingPage } from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { can } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { toast } from 'sonner';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, FieldSwitch } from '@/components/ui/field';

/** Batch 11.5 — randevu sayfası davranış ayarları. */
function Settings(): ReactNode {
  const { permissions } = useSession();
  const canManage = can(permissions, PERMISSIONS.BOOKING_PAGE_MANAGE);

  const [page, setPage] = useState<BookingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPage(await api.get<BookingPage>('booking-page'));
    } catch (caught) {
      setError(toMessage(caught));
    }
  }, []);

  useEffect(() => {
    // Efekt gövdesinde `void load()` çağırmak, lint için setState'i SENKRON
    // çağırmak sayılıyor (`react-hooks/set-state-in-effect`). Async sarmalayıcı
    // durum güncellemesini promise geri çağrısına taşıyor.
    void (async () => {
      await load();
    })();
  }, [load]);

  async function update(patch: Record<string, unknown>): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      setPage(await api.put<BookingPage>('booking-page', patch));
      // Anahtarlar anında değiştiği için kaydedildiğini SÖYLEYEN bir şey lazım;
      // aksi hâlde kullanıcı sunucuya gidip gitmediğini bilemiyor.
      toast.success(t('toast.saved'));
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (page === null) {
    // Hata varsa metin, yoksa iskelet: "Yükleniyor…" yazısı yükleme SÜRESİNCE
    // sayfanın nasıl bir şey olduğunu hiç anlatmıyordu.
    return error !== null ? (
      <Alert tone="danger">{error}</Alert>
    ) : (
      <div className="flex max-w-2xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const settings = page.settings;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t('page.title')} />
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardTitle>{t('page.canonicalUrl')}</CardTitle>
        <p className="text-sm">
          {page.canonicalUrl === '' ? (
            <span className="text-muted-foreground">{t('page.noDomain')}</span>
          ) : (
            <a href={page.canonicalUrl} className="underline" target="_blank" rel="noreferrer">
              {page.canonicalUrl}
            </a>
          )}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(`page.status.${page.status}` as 'page.status.draft')}
          {page.hasUnpublishedChanges ? ` · ${t('page.unpublishedChanges')}` : ''}
        </p>
      </Card>

      <Card>
        <CardTitle>{t('page.behaviour')}</CardTitle>
        <div className="flex flex-col gap-3">
          <FieldSwitch
            label={t('page.showStaffSelection')}
            checked={settings.showStaffSelection}
            disabled={!canManage || saving}
            onCheckedChange={(showStaffSelection) => void update({ showStaffSelection })}
          />
          <FieldSwitch
            label={t('page.showPrices')}
            checked={settings.showPrices}
            disabled={!canManage || saving}
            onCheckedChange={(showPrices) => void update({ showPrices })}
          />
          <FieldSwitch
            label={t('page.allowReschedule')}
            checked={settings.allowReschedule}
            disabled={!canManage || saving}
            onCheckedChange={(allowReschedule) => void update({ allowReschedule })}
          />
          <FieldSwitch
            label={t('page.requireOtp')}
            checked={settings.requireOtp}
            disabled={!canManage || saving}
            onCheckedChange={(requireOtp) => void update({ requireOtp })}
          />

          <Field
            label={t('page.holdTtlMinutes')}
            type="number"
            min={SETTINGS_LIMITS.holdTtlMinutes.min}
            max={SETTINGS_LIMITS.holdTtlMinutes.max}
            defaultValue={settings.holdTtlMinutes}
            readOnly={!canManage}
            hint={`${String(SETTINGS_LIMITS.holdTtlMinutes.min)}–${String(SETTINGS_LIMITS.holdTtlMinutes.max)} dakika.`}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (value !== settings.holdTtlMinutes) void update({ holdTtlMinutes: value });
            }}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Zamanlama</CardTitle>
        {/* `usesTenantDefaults` bir bilgi, bir ayar değil: kullanıcı bu üç
            değerin nereden geldiğini bilmeden override etmeyi anlamlandıramaz. */}
        {settings.usesTenantDefaults ? (
          <Alert tone="info" className="mb-3">
            Bu değerler klinik genelindeki varsayılanlardan geliyor.
          </Alert>
        ) : null}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">En erken randevu</dt>
          <dd>{settings.minLeadMinutes} dk sonra</dd>
          <dt className="text-muted-foreground">En geç randevu</dt>
          <dd>{settings.maxAdvanceDays} gün sonra</dd>
          <dt className="text-muted-foreground">İptal penceresi</dt>
          <dd>{settings.cancelWindowHours} saat</dd>
        </dl>
      </Card>

      {canManage ? null : (
        <p className="text-sm text-muted-foreground">{t('editor.readOnly')}</p>
      )}
    </div>
  );
}


function toMessage(caught: unknown): string {
  return caught instanceof ApiProblemError
    ? describeProblem(caught.problem, caught.retryAfterSeconds).message
    : networkError().message;
}

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.BOOKING_PAGE_READ]}>
      <Settings />
    </PermissionGate>
  );
}
