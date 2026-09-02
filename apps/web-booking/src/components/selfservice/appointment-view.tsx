'use client';

import { useEffect, useState } from 'react';
import type {
  PublicCategory,
  PublicSitePayload,
  PublicSlot,
  SelfServiceView,
} from '@klinara/shared';
import { bookingApi } from '@/lib/booking-fetch';
import { describeError, type UserFacingError } from '@/lib/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SlotPicker } from '@/components/booking/slot-picker';
import { t } from '@/i18n/tr';

/**
 * Self-servis randevu ekranı.
 *
 * Veri İSTEMCİDEN çekiliyor, RSC'den değil: uç `Cache-Control: no-store`
 * dönüyor ve token'ı sunucu tarafında istemek onu Next'in data cache'ine ve
 * sunucu log satırlarına sokardı. Ekran YALNIZ API'nin döndüğü alanları
 * gösteriyor — ek veri çekmiyor, çünkü token tek randevuya kapsanmış bir
 * anahtar, müşteri kartına açılan bir kapı değil.
 */
export function AppointmentView({
  site,
  categories,
  token,
}: {
  site: PublicSitePayload;
  categories: PublicCategory[];
  token: string;
}) {
  /**
   * İlk yükleme sonucu tek bir state'te: state yalnız asenkron callback'te
   * yazılıyor, efekt gövdesinde senkron `setState` yok. `loading` de türev.
   */
  const [loaded, setLoaded] = useState<{
    view: SelfServiceView | null;
    error: UserFacingError | null;
  } | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [busy, setBusy] = useState(false);

  const base = `sites/${site.slug}/appointments/${token}`;

  useEffect(() => {
    let cancelled = false;
    bookingApi
      .get<SelfServiceView>(base)
      .then((data) => {
        if (!cancelled) setLoaded({ view: data, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoaded({ view: null, error: describeError(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const loading = loaded === null;
  const view = loaded?.view ?? null;
  const error = loaded?.error ?? null;

  const setView = (next: SelfServiceView): void => {
    setLoaded({ view: next, error: null });
  };
  const setError = (next: UserFacingError): void => {
    setLoaded((current) => ({ view: current?.view ?? null, error: next }));
  };

  async function cancel(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      setView(await bookingApi.post<SelfServiceView>(`${base}/cancel`));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reschedule(slot: PublicSlot): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      setView(
        await bookingApi.post<SelfServiceView>(`${base}/reschedule`, {
          slotToken: slot.slotToken,
        }),
      );
      setRescheduling(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="mx-auto max-w-xl px-6 py-16 text-sm opacity-70">{t('common.loading')}</p>;
  }

  // Süresi dolmuş ya da geçersiz bağlantı: randevu ekranı yerine ANLAŞILIR bir
  // ekran ve randevu almaya dönüş yolu.
  if (view === null) {
    return (
      <section className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold">{t('selfservice.expired')}</h1>
        <p className="mt-3 text-sm opacity-75">
          {error?.message ?? 'Bağlantı artık geçerli değil.'}
        </p>
        <a className="mt-6 inline-block underline underline-offset-4" href="/randevu">
          Yeni randevu al
        </a>
      </section>
    );
  }

  const branch = site.branches.find((item) => item.name === view.branchName);
  // Erteleme, aynı hizmet(ler) için uygunluk sorgusu gerektiriyor ama
  // self-servis yanıtı kimlik değil AD taşıyor (dar PII beyaz listesi).
  // Kimlikleri public katalogdan eşliyoruz; hizmet adı değişmişse eşleşme
  // düşer ve erteleme düğmesi gösterilmez — yanlış hizmete randevu taşımak
  // yerine kullanıcıyı kliniğe yönlendirmek doğru davranış.
  const serviceIds = resolveServiceIds(categories, view.serviceNames);
  const canReschedule = view.canReschedule && branch !== undefined && serviceIds !== null;

  return (
    <section className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Randevunuz</h1>

      {error !== null && (
        <Alert className="mt-6">
          <p>{error.message}</p>
          {/* İptal penceresi kapalıysa tek doğru kurtarma adımı kliniği
              aramak; numarayı ekranda vermeyip "arayın" demek işe yaramaz. */}
          {error.recovery === 'none' && view.branchPhone !== null && (
            <a className="mt-1 block font-medium underline" href={`tel:${view.branchPhone}`}>
              {view.branchPhone}
            </a>
          )}
        </Alert>
      )}

      <dl className="mt-6 divide-y divide-black/10 text-sm">
        <Row label="Durum" value={statusLabel(view.status)} />
        <Row
          label="Tarih ve saat"
          value={formatDateTime(view.startsAt, view.timezone)}
        />
        <Row label="Hizmet" value={view.serviceNames.join(', ')} />
        <Row label="Şube" value={view.branchName} />
        {view.branchAddress !== null && <Row label="Adres" value={view.branchAddress} />}
        {view.branchPhone !== null && (
          <Row
            label="Telefon"
            value={
              <a className="underline" href={`tel:${view.branchPhone}`}>
                {view.branchPhone}
              </a>
            }
          />
        )}
      </dl>

      <div className="mt-8 flex flex-wrap gap-3">
        {/* `.ics` proxy üzerinden iniyor; `Content-Disposition` aynen geçiyor. */}
        <a href={`/api/b/${base}/ics`} download="randevu.ics">
          <Button type="button" variant="outline">
            {t('selfservice.ics')}
          </Button>
        </a>

        {canReschedule && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setRescheduling((value) => !value);
            }}
          >
            {t('selfservice.reschedule')}
          </Button>
        )}

        {view.canCancel && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void cancel();
            }}
          >
            {t('selfservice.cancel')}
          </Button>
        )}
      </div>

      {!view.canCancel && view.status !== 'cancelled' && (
        <p className="mt-4 text-sm opacity-75">
          {t('selfservice.windowClosed')}{' '}
          {view.branchPhone !== null && (
            <a className="font-medium underline" href={`tel:${view.branchPhone}`}>
              {view.branchPhone}
            </a>
          )}
        </p>
      )}

      {rescheduling && branch !== undefined && serviceIds !== null && (
        <div className="mt-8 border-t border-black/10 pt-6">
          <h2 className="mb-4 text-lg font-semibold">Yeni saat seçin</h2>
          {/* 11.2'nin slot bileşeni AYNEN yeniden kullanılıyor: erteleme,
              kullanıcı açısından ilk seçimle aynı işlem. */}
          <SlotPicker
            query={{
              slug: site.slug,
              branchId: branch.id,
              serviceIds,
              staffRef: null,
              timezone: view.timezone,
            }}
            selectedSlotToken={null}
            onSelect={(slot) => {
              void reschedule(slot);
            }}
          />
        </div>
      )}
    </section>
  );
}

/** Hizmet adları → public katalogdaki kimlikler. Biri eşleşmezse `null`. */
function resolveServiceIds(categories: PublicCategory[], names: string[]): string[] | null {
  const byName = new Map(
    categories.flatMap((category) => category.services.map((s) => [s.name, s.id] as const)),
  );
  const ids = names.map((name) => byName.get(name));
  return ids.every((id): id is string => id !== undefined) ? ids : null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="opacity-70">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: 'Planlandı',
    confirmed: 'Onaylandı',
    cancelled: 'İptal edildi',
    completed: 'Tamamlandı',
    no_show: 'Gelinmedi',
  };
  return labels[status] ?? status;
}

function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
