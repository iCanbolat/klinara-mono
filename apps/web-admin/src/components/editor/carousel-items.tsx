'use client';

import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { CONTENT_LIMITS, type CarouselItemInput } from '@klinara/shared';
import { moveItem } from '@/lib/editor/move-block';
import { assetLabel, useAssetLibrary, ACCEPT_ATTRIBUTE } from '@/lib/editor/use-asset-library';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const LIMITS = CONTENT_LIMITS.carousel;

/**
 * Karusel ögelerinin düzenleyicisi (Faz 11.5'ten devreden madde).
 *
 * Blok formu bu alanı salt okunur bir sayaç olarak gösteriyordu; galeriyi
 * kurmanın tek yolu API'ye elle istek atmaktı.
 *
 * Sıralama `BlockList` ile AYNI deseni izliyor ve bu bir tercih değil,
 * tutarlılık meselesi: birincil mekanizma erişilebilir olan ("Yukarı/Aşağı
 * taşı" düğmeleri, `aria-label`da SIRA NUMARASI ile), taşıma sonrası odak
 * taşınan satırda kalıyor ve değişiklik `role="status"` ile duyuruluyor.
 * Sürükle-bırak BURADA YOK: blok listesinde fare kolaylığı olarak eklenmişti,
 * ama karusel satırları metin girdileri taşıyor ve `draggable` bir satırda
 * metin seçmek tarayıcıda sürüklemeye dönüşüyor — kolaylık değil, engel.
 *
 * Öge sayısı `CONTENT_LIMITS.carousel.items`ta dolduğunda "Görsel ekle"
 * DEVRE DIŞI kalıyor: sınırı forma elle yazmak yerine sözlükten okumak, sunucu
 * sınırı değiştiğinde ikisinin ayrışmamasını sağlıyor.
 */
export function CarouselItems({
  items,
  label,
  readOnly,
  error,
  onChange,
}: {
  items: readonly CarouselItemInput[];
  label: string;
  readOnly: boolean;
  error: string | undefined;
  onChange: (items: CarouselItemInput[]) => void;
}): ReactNode {
  const library = useAssetLibrary();
  const [announcement, setAnnouncement] = useState('');
  const moveRefs = useRef(new Map<number, HTMLButtonElement>());

  const full = items.length >= LIMITS.items;

  function patch(index: number, next: Partial<CarouselItemInput>): void {
    onChange(
      items.map((item, position) =>
        position === index ? pruneEmpty({ ...item, ...next }) : item,
      ),
    );
  }

  function move(from: number, direction: -1 | 1): void {
    const to = from + direction;
    if (to < 0 || to >= items.length) return;
    onChange(moveItem(items, from, to));
    setAnnouncement(t('carousel.moved', { position: to + 1 }));
    requestAnimationFrame(() => moveRefs.current.get(to)?.focus());
  }

  async function addUploaded(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    const uploaded = await library.upload(file, 'booking_gallery');
    if (uploaded !== null) onChange([...items, { assetId: uploaded }]);
    event.target.value = '';
  }

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-sm font-medium text-foreground">{label}</legend>

      {/* `polite`: sıralama kullanıcının kendi eylemi, sözünü kesmemeli. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('carousel.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li
              key={index}
              className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2"
            >
              <div className="flex items-center gap-1">
                <span className="flex-1 text-xs font-medium text-muted-foreground">
                  {t('carousel.item', { position: index + 1 })}
                </span>
                {readOnly ? null : (
                  <>
                    <button
                      type="button"
                      ref={(node) => {
                        if (node === null) moveRefs.current.delete(index);
                        else moveRefs.current.set(index, node);
                      }}
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t('carousel.moveUp', { position: index + 1 })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === items.length - 1}
                      aria-label={t('carousel.moveDown', { position: index + 1 })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChange(items.filter((_, position) => position !== index))
                      }
                      aria-label={t('carousel.remove', { position: index + 1 })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>

              <label className="flex flex-col gap-1">
                <span className="sr-only">{t('carousel.image', { position: index + 1 })}</span>
                <select
                  value={item.assetId}
                  onChange={(event) => patch(index, { assetId: event.target.value })}
                  disabled={readOnly}
                  aria-label={t('carousel.image', { position: index + 1 })}
                  className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                >
                  {/*
                    Kütüphanede olmayan bir kimlik (başka bir kullanıcının
                    sildiği varlık) seçili kalabilir; onu bir seçenek olarak
                    göstermeseydik `select` ilk ögeye kayar ve KULLANICI HİÇ
                    DOKUNMADAN blok başka bir görseli işaret ederdi.
                  */}
                  {library.assets.some((asset) => asset.id === item.assetId) ? null : (
                    <option value={item.assetId}>{item.assetId.slice(0, 8)}</option>
                  )}
                  {library.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {assetLabel(asset)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('carousel.alt')}</span>
                <input
                  value={item.alt ?? ''}
                  onChange={(event) => patch(index, { alt: event.target.value })}
                  maxLength={LIMITS.alt}
                  readOnly={readOnly}
                  className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('carousel.caption')}</span>
                <input
                  value={item.caption ?? ''}
                  onChange={(event) => patch(index, { caption: event.target.value })}
                  maxLength={LIMITS.caption}
                  readOnly={readOnly}
                  className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                />
              </label>
            </li>
          ))}
        </ol>
      )}

      {readOnly ? null : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={full || library.assets.length === 0}
              onClick={() => {
                const first = library.assets[0];
                if (first !== undefined) onChange([...items, { assetId: first.id }]);
              }}
            >
              {t('carousel.add')}
            </Button>
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              onChange={(event) => void addUploaded(event)}
              disabled={library.uploading || full}
              aria-label={t('asset.upload')}
              className="text-xs text-muted-foreground"
            />
          </div>
          {full ? (
            <p className="text-xs text-muted-foreground">{t('carousel.full', { max: LIMITS.items })}</p>
          ) : null}
        </div>
      )}

      {library.uploading ? <p className="text-xs text-muted-foreground">{t('asset.uploading')}</p> : null}
      {library.error !== null ? <Alert tone="danger">{library.error}</Alert> : null}
      {error !== undefined ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/**
 * Boş dizeyi ALANIN KENDİSİNİ SİLEREK temizler.
 *
 * `alt: ''` göndermek sunucuda bir doğrulama hatası değil ama `content_hash`ı
 * değiştirir: kullanıcı bir başlığı yazıp silince "kaydedilmemiş değişiklik"
 * rozetinin yanmaya devam etmesi demekti. `block-form.tsx` metin alanlarında
 * aynı kararı veriyor.
 */
function pruneEmpty(item: CarouselItemInput): CarouselItemInput {
  const next: CarouselItemInput = { assetId: item.assetId };
  if (item.alt !== undefined && item.alt !== '') next.alt = item.alt;
  if (item.caption !== undefined && item.caption !== '') next.caption = item.caption;
  return next;
}
