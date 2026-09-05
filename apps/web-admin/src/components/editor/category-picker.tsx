'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ServiceCategory } from '@klinara/shared';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/tr';

/** Yükleme durumu; `unavailable` = liste okunamadı (çoğunlukla 403). */
type LoadState = 'loading' | 'ready' | 'unavailable';

/**
 * `serviceList.categoryIds` süzgeci (Faz 11.5'ten devreden madde).
 *
 * Blok formu bu alanı salt okunur bir sayaç olarak gösteriyordu; kategori
 * süzmenin tek yolu API'ye elle UUID göndermekti.
 *
 * ÜÇ KARAR:
 *
 * 1. **Boş seçim = TÜM hizmetler.** Bu blokta "hiçbiri" diye bir durum yok ve
 *    olmamalı — boş bir hizmet listesi yayınlamak kullanıcının isteyeceği bir
 *    şey değil, unuttuğu bir şeydir. Açıklama listenin başında duruyor.
 * 2. **Liste okunamazsa SEÇİM KORUNUR.** Uç `service:read` istiyor; bu izni
 *    olmayan bir içerik editörü 403 alır. O durumda kutuları gizleyip seçimi
 *    de silmek, kullanıcının göremediği bir alanı sessizce boşaltmak olurdu —
 *    kaydettiğinde süzgeç kalkar ve fark etmez. Bunun yerine seçili kimlikler
 *    salt okunur listelenip sebep açıkça söyleniyor.
 * 3. **Pasif kategori seçiliyse GÖSTERİLİYOR**, listeden gizlenmiyor: seçimi
 *    görünmez kılmak, kaldırılamayan bir süzgeç demekti.
 */
export function CategoryPicker({
  label,
  selected,
  maxItems,
  readOnly,
  error,
  onChange,
}: {
  label: string;
  selected: readonly string[];
  maxItems: number;
  readOnly: boolean;
  error: string | undefined;
  onChange: (ids: string[] | undefined) => void;
}): ReactNode {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    void (async () => {
      try {
        const response = await api.get<{ data: ServiceCategory[] }>('service-categories');
        setCategories(response.data);
        setState('ready');
      } catch {
        setState('unavailable');
      }
    })();
  }, []);

  /** Seçim boşalınca alanı SİL (`undefined`): `[]` ile aynı anlam, fazladan alan. */
  function toggle(id: string, checked: boolean): void {
    const next = checked ? [...selected, id] : selected.filter((value) => value !== id);
    onChange(next.length === 0 ? undefined : next);
  }

  const known = new Set(categories.map((category) => category.id));
  const orphans = selected.filter((id) => !known.has(id));
  const full = selected.length >= maxItems;

  return (
    <fieldset className="flex flex-col gap-1.5 border-0 p-0">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      <p className="text-xs text-muted-foreground">{t('category.all')}</p>

      {state === 'loading' ? <p className="text-sm text-muted-foreground">{t('category.loading')}</p> : null}

      {state === 'unavailable' ? (
        <>
          <p className="text-sm text-muted-foreground">{t('category.unavailable')}</p>
          <p className="text-sm text-foreground">{t('category.selectedCount', { count: selected.length })}</p>
        </>
      ) : null}

      {state === 'ready' ? (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
          {categories.map((category) => {
            const checked = selected.includes(category.id);
            return (
              <label key={category.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  // Sınır dolduğunda YALNIZ seçilmemiş kutular kilitleniyor;
                  // seçilileri de kilitlemek kullanıcıyı sınırın içinde
                  // hapsederdi (hiçbirini kaldıramaz, hiçbirini ekleyemez).
                  disabled={readOnly || (full && !checked)}
                  // Erişilebilir ad AÇIKÇA veriliyor: hesaplama etiketin metin
                  // düğümlerini kırpıp BOŞLUKSUZ birleştiriyor, yani görsel
                  // ayrımı olan "Epilasyon (pasif)" ekran okuyucuda
                  // "Epilasyon(pasif)" olarak okunurdu.
                  aria-label={
                    category.isActive
                      ? category.name
                      : `${category.name} (${t('category.inactive')})`
                  }
                  onChange={(event) => toggle(category.id, event.target.checked)}
                />
                <span>{category.name}</span>
                {category.isActive ? null : (
                  <span aria-hidden="true" className="text-xs text-muted-foreground">
                    {`(${t('category.inactive')})`}
                  </span>
                )}
              </label>
            );
          })}

          {orphans.map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked
                disabled={readOnly}
                onChange={() => toggle(id, false)}
              />
              <span className="text-muted-foreground">{t('category.unknown', { id: id.slice(0, 8) })}</span>
            </label>
          ))}
        </div>
      ) : null}

      {full ? <p className="text-xs text-muted-foreground">{t('category.full', { max: maxItems })}</p> : null}
      {error !== undefined ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
