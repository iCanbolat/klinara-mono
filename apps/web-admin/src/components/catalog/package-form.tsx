'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Branch, Service, ServiceCategorySummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { formatMoney } from '@/lib/format/money';
import { errorFor, fieldPath, toFormErrors, type FormErrors } from '@/lib/forms/field-errors';
import {
  MAX_ITEM_QUANTITY,
  MAX_PACKAGE_ITEMS,
  discountMinor,
  discountPercent,
  listTotalMinor,
  servicePriceMinor,
  slugify,
  totalSessions,
  type PackageDefinition,
  type PackageItemDraft,
} from '@/lib/catalog/package-definitions';
import { useBranch } from '@/components/session/branch-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldSelect, FieldSwitch, FieldTextarea } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { PackageServicePicker } from './package-service-picker';

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

/**
 * Paket tanımı oluşturma / düzenleme.
 *
 * Kalem listesi formun KALBİ: bir paket birden çok hizmet içerebilir
 * (10 lazer + 2 bakım) ve kalan hak kalem bazında tutulur. Satış fiyatı
 * kalemlerin katalog toplamından bağımsızdır; aradaki fark canlı gösterilir —
 * kullanıcı fiyatı yazarken indirimi görmezse kampanyayı körlemesine kurar.
 *
 * Düzenlemede `slug` ve şube KİLİTLİ: ikisi de satılmış paketlerin izini
 * taşıyor ve sunucu `PATCH` gövdesinde ikisini de kabul etmiyor. `items`
 * verilirse TAMAMEN değiştirilir; form her zaman tam listeyi gönderiyor.
 */
export function PackageFormDialog({
  open,
  definition,
  services,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` = oluşturma. */
  definition: PackageDefinition | null;
  services: readonly Service[];
  categories: readonly ServiceCategorySummary[];
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const { branches } = useBranch();
  const isEditing = definition !== null;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<PackageItemDraft[]>([]);
  const [priceMinor, setPriceMinor] = useState<number | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [validityDays, setValidityDays] = useState<string | null>(null);
  const [transferable, setTransferable] = useState(true);
  const [onlineSellable, setOnlineSellable] = useState(false);
  const [active, setActive] = useState(true);
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await Promise.resolve();
      setName(definition?.name ?? '');
      setSlug(definition?.slug ?? '');
      setSlugTouched(definition !== null);
      setDescription(definition?.description ?? '');
      setItems(
        [...(definition?.items ?? [])]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => ({
            serviceId: item.serviceId,
            serviceName: item.serviceName,
            unitListPriceMinor: item.unitListPriceMinor,
            quantity: item.quantity,
          })),
      );
      setPriceMinor(definition?.totalPriceMinor ?? null);
      setBranchId(definition?.branchId ?? null);
      setValidityDays(definition?.validityDays == null ? null : String(definition.validityDays));
      setTransferable(definition?.isTransferable ?? true);
      setOnlineSellable(definition?.isOnlineSellable ?? false);
      setActive(definition?.isActive ?? true);
      setPicking(false);
      setErrors(NO_ERRORS);
      setBusy(false);
    })();
  }, [open, definition]);

  const listMinor = listTotalMinor(items);
  const discount = discountMinor(listMinor, priceMinor);
  const percent = discountPercent(listMinor, priceMinor);
  const sessions = totalSessions(items);
  const existingIds = new Set(items.map((item) => item.serviceId));
  const parsedValidity = validityDays === null ? null : Number.parseInt(validityDays, 10);
  const validityValid =
    parsedValidity === null ||
    (Number.isInteger(parsedValidity) && parsedValidity >= 1 && parsedValidity <= 3650);
  const quantitiesValid = items.every(
    (item) => Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= MAX_ITEM_QUANTITY,
  );

  const canSave =
    !busy &&
    name.trim().length >= 2 &&
    slug.trim().length >= 2 &&
    items.length > 0 &&
    quantitiesValid &&
    priceMinor !== null &&
    priceMinor >= 0 &&
    validityValid;

  function changeName(value: string): void {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function addServices(selected: Service[]): void {
    setItems((current) => [
      ...current,
      ...selected
        .filter((service) => !current.some((item) => item.serviceId === service.id))
        .map((service) => ({
          serviceId: service.id,
          serviceName: service.name,
          unitListPriceMinor: servicePriceMinor(service, branchId),
          quantity: 1,
        })),
    ]);
    setPicking(false);
  }

  function setQuantity(index: number, quantity: number): void {
    setItems((current) => current.map((row, i) => (i === index ? { ...row, quantity } : row)));
  }

  async function submit(): Promise<void> {
    if (priceMinor === null) return;
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const wireItems = items.map((item) => ({
        serviceId: item.serviceId,
        quantity: item.quantity,
      }));
      if (definition === null) {
        await api.post<PackageDefinition>('package-definitions', {
          slug: slug.trim(),
          name: name.trim(),
          ...(description.trim() === '' ? {} : { description: description.trim() }),
          totalPriceMinor: priceMinor,
          ...(branchId === null ? {} : { branchId }),
          ...(parsedValidity === null ? {} : { validityDays: parsedValidity }),
          isTransferable: transferable,
          isOnlineSellable: onlineSellable,
          isActive: active,
          items: wireItems,
        });
      } else {
        await api.patch<PackageDefinition>(
          `package-definitions/${definition.id}`,
          {
            name: name.trim(),
            description: description.trim() === '' ? null : description.trim(),
            totalPriceMinor: priceMinor,
            validityDays: parsedValidity,
            isTransferable: transferable,
            isOnlineSellable: onlineSellable,
            isActive: active,
            // TAM liste — sunucu kalemleri bununla değiştiriyor.
            items: wireItems,
          },
          { ifMatch: `W/"${String(definition.version)}"` },
        );
      }
      toast.success(t('packages.saved'));
      onSaved();
    } catch (caught) {
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  const branchName = (id: string): string =>
    branches.find((branch: Branch) => branch.id === id)?.name ?? id;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('packages.edit') : t('packages.new')}</DialogTitle>
          <DialogDescription>{t('packages.snapshotNote')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-6">
          {/* --- Tanım --- */}
          <section className="flex flex-col gap-3">
            <h3 className="text-label">{t('packages.sectionBasics')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('packages.name')}
                value={name}
                placeholder={t('packages.namePlaceholder')}
                disabled={busy}
                error={errorFor(errors, 'name')}
                onChange={(event) => changeName(event.target.value)}
              />
              <Field
                label={t('packages.slug')}
                value={slug}
                disabled={busy || isEditing}
                hint={t('packages.slugHint')}
                error={errorFor(errors, 'slug')}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
              />
            </div>
            <FieldTextarea
              label={t('packages.description')}
              value={description}
              rows={2}
              maxLength={2000}
              disabled={busy}
              error={errorFor(errors, 'description')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </section>

          {/* --- Kalemler --- */}
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-label">{t('packages.sectionItems')}</h3>
              {items.length > 0 ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('packages.sessions', { count: sessions })}
                </span>
              ) : null}
            </div>

            {items.length === 0 && !picking ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t('packages.itemsEmpty')}
              </p>
            ) : null}

            {items.length > 0 ? (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {items.map((item, index) => (
                  <li key={item.serviceId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{item.serviceName}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t('packages.unitPrice', { price: formatMoney(item.unitListPriceMinor) })}
                      </span>
                      {errorFor(errors, fieldPath('items', index, 'quantity')) !== undefined ? (
                        <span className="text-xs text-destructive">
                          {errorFor(errors, fieldPath('items', index, 'quantity'))}
                        </span>
                      ) : null}
                    </div>

                    <QuantityStepper
                      label={`${item.serviceName} — ${t('packages.quantity')}`}
                      value={item.quantity}
                      disabled={busy}
                      onChange={(quantity) => setQuantity(index, quantity)}
                    />

                    <span className="w-24 text-right text-sm tabular-nums">
                      {formatMoney(item.unitListPriceMinor * item.quantity)}
                    </span>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={t('packages.removeItem', { name: item.serviceName })}
                      onClick={() =>
                        setItems((current) => current.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {picking ? (
              <PackageServicePicker
                services={services}
                categories={categories}
                existingServiceIds={existingIds}
                branchId={branchId}
                remaining={MAX_PACKAGE_ITEMS - items.length}
                onAdd={addServices}
                onCancel={() => setPicking(false)}
              />
            ) : items.length < MAX_PACKAGE_ITEMS ? (
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                disabled={busy}
                onClick={() => setPicking(true)}
              >
                <Plus aria-hidden="true" />
                {t('packages.addService')}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('packages.itemsLimit', { max: MAX_PACKAGE_ITEMS })}
              </p>
            )}

            {errorFor(errors, 'items') !== undefined ? (
              <p className="text-xs text-destructive">{errorFor(errors, 'items')}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{t('packages.itemsHint')}</p>
          </section>

          {/* --- Fiyat --- */}
          <section className="flex flex-col gap-3">
            <h3 className="text-label">{t('packages.sectionPricing')}</h3>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <MoneyInput
                label={t('packages.salePrice')}
                valueMinor={priceMinor}
                disabled={busy}
                error={errorFor(errors, 'totalPriceMinor')}
                onChange={setPriceMinor}
              />
              <dl className="grid gap-1.5 rounded-xl bg-muted/50 px-4 py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('packages.listTotal')}</dt>
                  <dd className="tabular-nums">{formatMoney(listMinor)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('packages.discount')}</dt>
                  <dd className="tabular-nums">
                    {discount === null ? (
                      <span className="text-muted-foreground">{t('packages.noDiscount')}</span>
                    ) : (
                      <span className="font-medium text-primary">
                        {formatMoney(discount)}
                        {percent === null ? null : ` (%${String(percent)})`}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          {/* --- Kapsam ve kurallar --- */}
          <section className="flex flex-col gap-1">
            <h3 className="mb-2 text-label">{t('packages.sectionScope')}</h3>

            {branches.length > 1 ? (
              <div className="mb-2">
                <FieldSelect
                  label={t('packages.branch')}
                  value={branchId ?? ''}
                  disabled={busy || isEditing}
                  hint={t('packages.branchHint')}
                  error={errorFor(errors, 'branchId')}
                  onChange={(event) =>
                    setBranchId(event.target.value === '' ? null : event.target.value)
                  }
                >
                  <option value="">{t('packages.allBranches')}</option>
                  {branches.map((branch: Branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branchName(branch.id)}
                    </option>
                  ))}
                </FieldSelect>
              </div>
            ) : null}

            <FieldSwitch
              label={t('packages.hasValidity')}
              hint={
                validityDays === null
                  ? t('packages.hasValidityHint')
                  : t('packages.validityDaysHint')
              }
              checked={validityDays !== null}
              disabled={busy}
              onCheckedChange={(checked) => setValidityDays(checked ? '365' : null)}
            />
            {validityDays !== null ? (
              <div className="max-w-48 pb-2">
                <Field
                  label={t('packages.validityDays')}
                  type="number"
                  min={1}
                  max={3650}
                  value={validityDays}
                  disabled={busy}
                  suffix="gün"
                  error={errorFor(errors, 'validityDays')}
                  onChange={(event) => setValidityDays(event.target.value)}
                />
              </div>
            ) : null}
            <FieldSwitch
              label={t('packages.transferable')}
              hint={t('packages.transferableHint')}
              checked={transferable}
              disabled={busy}
              onCheckedChange={setTransferable}
            />
            <FieldSwitch
              label={t('packages.onlineSellable')}
              checked={onlineSellable}
              disabled={busy}
              onCheckedChange={setOnlineSellable}
            />
            <FieldSwitch
              label={t('packages.active')}
              hint={t('packages.activeHint')}
              checked={active}
              disabled={busy}
              onCheckedChange={setActive}
            />
          </section>

          {errors.message !== null ? (
            <Alert tone="danger">
              <span role="alert">{errors.message}</span>
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="hidden text-sm text-muted-foreground tabular-nums sm:block">
            {items.length > 0 && priceMinor !== null
              ? `${t('packages.sessions', { count: sessions })} · ${formatMoney(priceMinor)}`
              : null}
          </span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('calendar.detail.close')}
            </Button>
            <Button type="button" loading={busy} disabled={!canSave} onClick={() => void submit()}>
              {t('customers.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** − [ 10 ] + — seans adedi. Doğrudan yazılabilir; düğmeler 1…1000 sınırında. */
function QuantityStepper({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}): ReactNode {
  const clamp = (next: number): number => Math.min(MAX_ITEM_QUANTITY, Math.max(1, next));
  return (
    <div className="flex items-center rounded-lg border border-input bg-card">
      <button
        type="button"
        aria-label={`${label} −1`}
        disabled={disabled || value <= 1}
        onClick={() => onChange(clamp(value - 1))}
        className="flex size-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_ITEM_QUANTITY}
        aria-label={label}
        value={Number.isNaN(value) ? '' : value}
        disabled={disabled}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        onBlur={() => onChange(clamp(Number.isNaN(value) ? 1 : value))}
        className="h-9 w-12 [appearance:textfield] bg-transparent text-center text-sm tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`${label} +1`}
        disabled={disabled || value >= MAX_ITEM_QUANTITY}
        onClick={() => onChange(clamp((Number.isNaN(value) ? 0 : value) + 1))}
        className="flex size-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
