'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import type { Service, ServiceCategorySummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format/money';
import { servicePriceMinor } from '@/lib/catalog/package-definitions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Paket formunun içinde açılan çoklu hizmet seçici.
 *
 * Popover DEĞİL, formun içinde açılan bir panel: dialog'un odak tuzağıyla
 * kavga etmiyor ve uzun bir katalogda dialog'un kendi kaydırmasıyla
 * birlikte doğal kayıyor. iOS `PackageServicePickerSheet` ile aynı model:
 * kategoriye göre gruplu, çoklu seçim, pakette olanlar "Eklendi" ve
 * seçilemez (sunucu aynı hizmeti iki kez kabul etmiyor).
 */
export function PackageServicePicker({
  services,
  categories,
  existingServiceIds,
  branchId,
  remaining,
  onAdd,
  onCancel,
}: {
  services: readonly Service[];
  categories: readonly ServiceCategorySummary[];
  existingServiceIds: ReadonlySet<string>;
  /** Fiyat gösterimi için paket kapsamı; `null` = tüm şubeler (katalog fiyatı). */
  branchId: string | null;
  /** Kalem sınırına kalan yer — fazlası seçilemez. */
  remaining: number;
  onAdd: (services: Service[]) => void;
  onCancel: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    const categoryName = (id: string): string =>
      categories.find((category) => category.id === id)?.name ?? '';
    const visible = services
      .filter((service) => service.isActive)
      .filter(
        (service) =>
          needle === '' ||
          service.name.toLocaleLowerCase('tr').includes(needle) ||
          categoryName(service.categoryId).toLocaleLowerCase('tr').includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

    const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    const known = new Set(ordered.map((category) => category.id));
    const result = ordered
      .map((category) => ({
        key: category.id,
        name: category.name,
        services: visible.filter((service) => service.categoryId === category.id),
      }))
      .filter((group) => group.services.length > 0);
    const orphans = visible.filter((service) => !known.has(service.categoryId));
    if (orphans.length > 0) result.push({ key: '—', name: 'Kategorisiz', services: orphans });
    return result;
  }, [services, categories, query]);

  const full = selected.length >= remaining;

  function toggle(id: string): void {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= remaining
          ? current
          : [...current, id],
    );
  }

  function confirm(): void {
    onAdd(
      selected
        .map((id) => services.find((service) => service.id === id))
        .filter((service): service is Service => service !== undefined),
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground"
          />
          <Input
            autoFocus
            value={query}
            placeholder={t('packages.pickerSearch')}
            aria-label={t('packages.pickerSearch')}
            className="bg-background pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto" role="group" aria-label={t('packages.addService')}>
        {groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('packages.pickerEmpty')}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <p className="sticky top-0 z-10 bg-muted/80 px-4 py-1.5 text-label text-muted-foreground backdrop-blur">
                {group.name}
              </p>
              <ul>
                {group.services.map((service) => {
                  const added = existingServiceIds.has(service.id);
                  const checked = selected.includes(service.id);
                  const disabled = added || (!checked && full);
                  return (
                    <li key={service.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={added || checked}
                        disabled={disabled}
                        onClick={() => toggle(service.id)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          'hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                          'disabled:cursor-not-allowed disabled:hover:bg-transparent',
                          checked && 'bg-primary/5',
                          added && 'opacity-55',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full border border-border"
                          style={
                            service.calendarColor === null
                              ? undefined
                              : { backgroundColor: service.calendarColor, borderColor: 'transparent' }
                          }
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">
                            {service.name}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {service.durationMinutes} dk ·{' '}
                            {formatMoney(servicePriceMinor(service, branchId))}
                          </span>
                        </span>
                        {added ? (
                          <span className="text-xs text-muted-foreground">
                            {t('packages.pickerAdded')}
                          </span>
                        ) : (
                          <span
                            aria-hidden="true"
                            className={cn(
                              'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                              checked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input bg-card',
                            )}
                          >
                            {checked ? <Check className="size-3.5" /> : null}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-3 py-2.5">
        <span className="text-xs text-muted-foreground">
          {full && remaining > 0
            ? t('packages.itemsLimit', { max: remaining + existingServiceIds.size })
            : null}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t('packages.pickerCancel')}
          </Button>
          <Button type="button" size="sm" disabled={selected.length === 0} onClick={confirm}>
            {selected.length === 0
              ? t('packages.addService')
              : t('packages.addSelected', { count: selected.length })}
          </Button>
        </div>
      </div>
    </div>
  );
}
