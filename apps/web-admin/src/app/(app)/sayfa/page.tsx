'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PERMISSIONS, SETTINGS_LIMITS, type BookingPage } from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { can } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Card, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';

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
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (page === null) {
    return <p className="text-sm text-ink-soft">{error ?? t('common.loading')}</p>;
  }

  const settings = page.settings;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">{t('page.title')}</h1>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardTitle>{t('page.canonicalUrl')}</CardTitle>
        <p className="text-sm">
          {page.canonicalUrl === '' ? (
            <span className="text-ink-soft">Henüz bir alan adı yok.</span>
          ) : (
            <a href={page.canonicalUrl} className="underline" target="_blank" rel="noreferrer">
              {page.canonicalUrl}
            </a>
          )}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          {t(`page.status.${page.status}` as 'page.status.draft')}
          {page.hasUnpublishedChanges ? ` · ${t('page.unpublishedChanges')}` : ''}
        </p>
      </Card>

      <Card>
        <CardTitle>Randevu davranışı</CardTitle>
        <div className="flex flex-col gap-3">
          <Toggle
            label="Uygulayıcı seçimi gösterilsin"
            checked={settings.showStaffSelection}
            disabled={!canManage || saving}
            onChange={(showStaffSelection) => void update({ showStaffSelection })}
          />
          <Toggle
            label="Fiyatlar gösterilsin"
            checked={settings.showPrices}
            disabled={!canManage || saving}
            onChange={(showPrices) => void update({ showPrices })}
          />
          <Toggle
            label="Erteleme yapılabilsin"
            checked={settings.allowReschedule}
            disabled={!canManage || saving}
            onChange={(allowReschedule) => void update({ allowReschedule })}
          />
          <Toggle
            label="Telefon doğrulaması (OTP) zorunlu"
            checked={settings.requireOtp}
            disabled={!canManage || saving}
            onChange={(requireOtp) => void update({ requireOtp })}
          />

          <Field
            label="Slot tutma süresi (dakika)"
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
          <dt className="text-ink-soft">En erken randevu</dt>
          <dd>{settings.minLeadMinutes} dk sonra</dd>
          <dt className="text-ink-soft">En geç randevu</dt>
          <dd>{settings.maxAdvanceDays} gün sonra</dd>
          <dt className="text-ink-soft">İptal penceresi</dt>
          <dd>{settings.cancelWindowHours} saat</dd>
        </dl>
      </Card>

      {canManage ? null : (
        <p className="text-sm text-ink-soft">{t('editor.readOnly')}</p>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): ReactNode {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
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
