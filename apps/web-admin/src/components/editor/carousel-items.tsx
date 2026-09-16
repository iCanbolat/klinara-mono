'use client';

import { ChevronDown, ChevronUp, ImageOff, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { CONTENT_LIMITS, type CarouselItemInput } from '@klinara/shared';
import { moveItem } from '@/lib/editor/move-block';
import { useAssetLibrary } from '@/lib/editor/use-asset-library';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';
import { AssetLibraryDialog } from './asset-library-dialog';

const LIMITS = CONTENT_LIMITS.carousel;

/** Diyalog neyi seçiyor: yeni bir öge mi, var olan ögenin görseli mi. */
type Target = { kind: 'add' } | { kind: 'replace'; index: number };

/**
 * Karusel ögelerinin düzenleyicisi (Faz 11.5'ten devreden madde).
 *
 * Her öge küçük resmiyle bir kart: görsele tıklamak kütüphaneyi açıp o ögenin
 * görselini değiştiriyor, "Görsel ekle" aynı kütüphaneden yeni öge ekliyor.
 * Yerel `<select>` görselleri yalnız adlarıyla gösteriyordu.
 *
 * Sıralama `BlockList` ile AYNI deseni izliyor ve bu bir tercih değil,
 * tutarlılık meselesi: birincil mekanizma erişilebilir olan ("Yukarı/Aşağı
 * taşı" düğmeleri, `aria-label`da SIRA NUMARASI ile), taşıma sonrası odak
 * taşınan satırda kalıyor ve değişiklik `role="status"` ile duyuruluyor.
 * Sürükle-bırak BURADA YOK: karusel satırları metin girdileri taşıyor ve
 * `draggable` bir satırda metin seçmek tarayıcıda sürüklemeye dönüşüyor.
 *
 * Kütüphanede bulunmayan bir kimlik (başka bir kullanıcının sildiği varlık)
 * KORUNUYOR ve "görsel bulunamadı" olarak gösteriliyor; kullanıcı dokunmadan
 * ögenin başka bir görsele kayması, fark edilmeyen bir içerik değişikliği olurdu.
 *
 * Öge sayısı `CONTENT_LIMITS.carousel.items`ta dolduğunda "Görsel ekle"
 * DEVRE DIŞI kalıyor.
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
  const [target, setTarget] = useState<Target | null>(null);
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

  function select(assetId: string): void {
    if (target === null) return;
    if (target.kind === 'add') {
      const asset = library.assets.find((candidate) => candidate.id === assetId);
      // Kütüphanedeki alternatif metin başlangıç değeri olarak taşınıyor.
      const alt = asset?.altText ?? null;
      onChange([...items, alt === null ? { assetId } : { assetId, alt }]);
    } else {
      patch(target.index, { assetId });
    }
  }

  const selectedId = target?.kind === 'replace' ? (items[target.index]?.assetId ?? null) : null;

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium text-foreground">
        <span>{label}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {items.length}/{LIMITS.items}
        </span>
      </legend>

      {/* `polite`: sıralama kullanıcının kendi eylemi, sözünü kesmemeli. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
          {t('carousel.empty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => {
            const asset = library.assets.find((candidate) => candidate.id === item.assetId);
            const position = index + 1;
            return (
              <li key={index} className="flex gap-3 rounded-lg border border-border bg-card p-2">
                <div className="flex shrink-0 flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => setTarget({ kind: 'replace', index })}
                    aria-label={t('carousel.image', { position })}
                    className="group relative flex h-20 w-24 items-center justify-center overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  >
                    {asset !== undefined ? (
                      // eslint-disable-next-line @next/next/no-img-element -- küçük önizleme; optimize edici katmanı gereksiz.
                      <img src={asset.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-muted-foreground">
                        <ImageOff aria-hidden="true" className="size-4" />
                        {library.assets.length === 0 ? item.assetId.slice(0, 8) : t('asset.missing')}
                      </span>
                    )}
                    {readOnly ? null : (
                      <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        {t('asset.change')}
                      </span>
                    )}
                  </button>
                  <span className="text-center text-[11px] text-muted-foreground">
                    {t('carousel.item', { position })}
                  </span>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">{t('carousel.alt')}</span>
                    <input
                      value={item.alt ?? ''}
                      onChange={(event) => patch(index, { alt: event.target.value })}
                      maxLength={LIMITS.alt}
                      readOnly={readOnly}
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">{t('carousel.caption')}</span>
                    <input
                      value={item.caption ?? ''}
                      onChange={(event) => patch(index, { caption: event.target.value })}
                      maxLength={LIMITS.caption}
                      readOnly={readOnly}
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </label>
                </div>

                {readOnly ? null : (
                  <div className="flex shrink-0 flex-col items-center gap-0.5">
                    <button
                      type="button"
                      ref={(node) => {
                        if (node === null) moveRefs.current.delete(index);
                        else moveRefs.current.set(index, node);
                      }}
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t('carousel.moveUp', { position })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === items.length - 1}
                      aria-label={t('carousel.moveDown', { position })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(items.filter((_, other) => other !== index))}
                      aria-label={t('carousel.remove', { position })}
                      className="mt-auto rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {readOnly ? null : (
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="border-dashed"
            disabled={full}
            onClick={() => setTarget({ kind: 'add' })}
          >
            <Plus aria-hidden="true" className="size-4" />
            {t('carousel.add')}
          </Button>
          {full ? (
            <p className="text-xs text-muted-foreground">{t('carousel.full', { max: LIMITS.items })}</p>
          ) : null}
          <AssetLibraryDialog
            open={target !== null}
            onOpenChange={(open) => !open && setTarget(null)}
            library={library}
            purpose="booking_gallery"
            selectedId={selectedId}
            onSelect={select}
          />
        </>
      )}

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
