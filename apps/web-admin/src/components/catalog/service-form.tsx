'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Branch, Service, ServiceCategorySummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useBranch } from '@/components/session/branch-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldCheckbox, FieldSelect } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { errorFor, fieldPath, toFormErrors, type FormErrors } from '@/lib/forms/field-errors';

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

interface OverrideDraft {
  branchId: string;
  priceMinor: number | null;
  durationMinutes: string;
}

/**
 * Hizmet oluşturma / düzenleme.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `branchOverrides` TAM DEĞİŞTİRME
 * ---------------------------------------------------------------------------
 * `POST`/`PATCH` bu diziyi OLDUĞU GİBİ yazıyor: formda görünmeyen bir
 * override KAYDEDİLDİĞİNDE SİLİNİR. Bu yüzden form her zaman MEVCUT TAM
 * listeyi okuyup gönderiyor ve kullanıcıya bir satırla söylüyor.
 *
 * "Yalnız değişeni gönder" burada bir optimizasyon değil, veri kaybıdır.
 */
export function ServiceFormDialog({
  open,
  service,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` = oluşturma. */
  service: Service | null;
  categories: readonly ServiceCategorySummary[];
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const { branches } = useBranch();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [duration, setDuration] = useState('30');
  const [bufferBefore, setBufferBefore] = useState('0');
  const [bufferAfter, setBufferAfter] = useState('0');
  const [priceMinor, setPriceMinor] = useState<number | null>(0);
  const [onlineBookable, setOnlineBookable] = useState(true);
  const [active, setActive] = useState(true);
  const [overrides, setOverrides] = useState<OverrideDraft[]>([]);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await Promise.resolve();
      setName(service?.name ?? '');
      setSlug(service?.slug ?? '');
      setCategoryId(service?.categoryId ?? categories[0]?.id ?? '');
      setDuration(String(service?.durationMinutes ?? 30));
      setBufferBefore(String(service?.bufferBeforeMinutes ?? 0));
      setBufferAfter(String(service?.bufferAfterMinutes ?? 0));
      setPriceMinor(service?.priceMinor ?? 0);
      setOnlineBookable(service?.isOnlineBookable ?? true);
      setActive(service?.isActive ?? true);
      // MEVCUT TAM liste okunuyor — bkz. dosya başlığı.
      setOverrides(
        (service?.branchOverrides ?? []).map((override) => ({
          branchId: override.branchId,
          priceMinor: override.priceMinor,
          durationMinutes: override.durationMinutes === null ? '' : String(override.durationMinutes),
        })),
      );
      setErrors(NO_ERRORS);
      setBusy(false);
    })();
  }, [open, service, categories]);

  async function submit(): Promise<void> {
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const body = {
        categoryId,
        slug: slug.trim(),
        name: name.trim(),
        durationMinutes: Number.parseInt(duration, 10),
        bufferBeforeMinutes: Number.parseInt(bufferBefore, 10),
        bufferAfterMinutes: Number.parseInt(bufferAfter, 10),
        priceMinor: priceMinor ?? 0,
        isOnlineBookable: onlineBookable,
        isActive: active,
        // TAM liste — eksik gönderilen override silinir.
        branchOverrides: overrides.map((override) => ({
          branchId: override.branchId,
          ...(override.priceMinor === null ? {} : { priceMinor: override.priceMinor }),
          ...(override.durationMinutes.trim() === ''
            ? {}
            : { durationMinutes: Number.parseInt(override.durationMinutes, 10) }),
        })),
      };

      if (service === null) await api.post('services', body);
      else await api.patch(`services/${service.id}`, body);

      toast.success(t('catalog.saved'));
      onSaved();
    } catch (caught) {
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  const unusedBranches = branches.filter(
    (branch: Branch) => !overrides.some((override) => override.branchId === branch.id),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{service === null ? t('catalog.newService') : service.name}</DialogTitle>
          <DialogDescription className="sr-only">{t('catalog.title')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('catalog.name')}
            value={name}
            disabled={busy}
            error={errorFor(errors, 'name')}
            onChange={(event) => setName(event.target.value)}
          />
          <Field
            label={t('catalog.slug')}
            value={slug}
            disabled={busy}
            error={errorFor(errors, 'slug')}
            onChange={(event) => setSlug(event.target.value)}
          />
          <FieldSelect
            label={t('catalog.category')}
            value={categoryId}
            disabled={busy}
            error={errorFor(errors, 'categoryId')}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </FieldSelect>
          <Field
            label={t('catalog.duration')}
            type="number"
            min={1}
            value={duration}
            disabled={busy}
            error={errorFor(errors, 'durationMinutes')}
            onChange={(event) => setDuration(event.target.value)}
          />
          <Field
            label={t('catalog.bufferBefore')}
            type="number"
            min={0}
            value={bufferBefore}
            disabled={busy}
            onChange={(event) => setBufferBefore(event.target.value)}
          />
          <Field
            label={t('catalog.bufferAfter')}
            type="number"
            min={0}
            value={bufferAfter}
            disabled={busy}
            onChange={(event) => setBufferAfter(event.target.value)}
          />
          <MoneyInput
            label={t('catalog.price')}
            valueMinor={priceMinor}
            disabled={busy}
            error={errorFor(errors, 'priceMinor')}
            onChange={setPriceMinor}
          />
        </div>

        <div className="flex flex-col gap-2">
          <FieldCheckbox
            label={t('catalog.onlineBookable')}
            checked={onlineBookable}
            disabled={busy}
            onCheckedChange={setOnlineBookable}
          />
          <FieldCheckbox
            label={t('catalog.active')}
            checked={active}
            disabled={busy}
            onCheckedChange={setActive}
          />
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-label">{t('catalog.overrides')}</h3>
          {/* Kullanıcı tam değiştirmeyi BİLMELİ — bkz. dosya başlığı. */}
          <p className="text-xs text-muted-foreground">{t('catalog.overridesHint')}</p>

          {overrides.map((override, index) => (
            <div key={override.branchId} className="grid items-end gap-2 sm:grid-cols-3">
              <FieldSelect label={t('staff.branch')} value={override.branchId} disabled>
                <option value={override.branchId}>
                  {branches.find((branch: Branch) => branch.id === override.branchId)?.name ??
                    override.branchId}
                </option>
              </FieldSelect>
              <MoneyInput
                label={t('catalog.price')}
                valueMinor={override.priceMinor}
                disabled={busy}
                error={errorFor(errors, fieldPath('branchOverrides', index, 'priceMinor'))}
                onChange={(minor) =>
                  setOverrides((current) =>
                    current.map((row, i) => (i === index ? { ...row, priceMinor: minor } : row)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setOverrides((current) => current.filter((_, i) => i !== index))
                }
              >
                {t('catalog.removeOverride')}
              </Button>
            </div>
          ))}

          {unusedBranches.length > 0 ? (
            <FieldSelect
              label={t('catalog.addOverride')}
              value=""
              disabled={busy}
              onChange={(event) => {
                const branchId = event.target.value;
                if (branchId === '') return;
                setOverrides((current) => [
                  ...current,
                  { branchId, priceMinor: null, durationMinutes: '' },
                ]);
              }}
            >
              <option value="">—</option>
              {unusedBranches.map((branch: Branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </FieldSelect>
          ) : null}
        </section>

        {errors.message !== null ? (
          <Alert tone="danger">
            <span role="alert">{errors.message}</span>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('calendar.detail.close')}
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={busy || name.trim() === '' || slug.trim() === ''}
            onClick={() => void submit()}
          >
            {t('customers.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
