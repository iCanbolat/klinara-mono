'use client';

import { Check, ImagePlus, Loader2 } from 'lucide-react';
import { useId, useState, type DragEvent, type ReactNode } from 'react';
import type { AssetPurpose } from '@klinara/shared';
import { assetLabel, ACCEPT_ATTRIBUTE, type AssetLibrary } from '@/lib/editor/use-asset-library';
import { MAX_MEGABYTES } from '@/lib/editor/asset-rules';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Görsel kütüphanesi — küçük resim ızgarası ve sürükle-bırak yükleme.
 *
 * Yerel `<select>` görselleri yalnız alternatif metinleriyle (ya da kimliğin
 * ilk sekiz karakteriyle) listeliyordu; "hangisi bekleme salonuydu?" sorusu
 * seçip önizlemeye bakmadan cevaplanamıyordu.
 *
 * Kütüphane kancası ÇAĞIRANDAN geliyor: diyalog her açıldığında listeyi
 * yeniden istemesin ve yüklenen görsel çağıranın listesinde de görünsün.
 * Yükleme bittiğinde yeni görsel doğrudan SEÇİLİYOR — kullanıcının yüklediği
 * görseli ızgarada bir daha araması gereksiz bir adım olurdu.
 */
export function AssetLibraryDialog({
  open,
  onOpenChange,
  library,
  purpose,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: AssetLibrary;
  purpose: AssetPurpose;
  selectedId: string | null;
  onSelect: (assetId: string) => void;
}): ReactNode {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    const uploaded = await library.upload(file, purpose);
    if (uploaded !== null) {
      onSelect(uploaded);
      onOpenChange(false);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragOver(false);
    void upload(event.dataTransfer.files[0]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('asset.libraryTitle')}</DialogTitle>
          <DialogDescription>{t('asset.libraryDescription')}</DialogDescription>
        </DialogHeader>

        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors',
            dragOver ? 'border-primary bg-accent' : 'border-border hover:border-primary/40 hover:bg-muted/40',
            library.uploading && 'pointer-events-none opacity-60',
          )}
        >
          {library.uploading ? (
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus aria-hidden="true" className="size-5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium text-foreground">
            {library.uploading ? t('asset.uploading') : t('asset.dropzone')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('asset.dropzoneHint', { mb: MAX_MEGABYTES })}
          </span>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            aria-label={t('asset.upload')}
            disabled={library.uploading}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>

        {library.error !== null ? <Alert tone="danger">{library.error}</Alert> : null}

        {library.assets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('asset.libraryEmpty')}</p>
        ) : (
          <ul className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
            {library.assets.map((asset) => {
              const selected = asset.id === selectedId;
              const name = assetLabel(asset);
              return (
                <li key={asset.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={t('asset.select', { name })}
                    onClick={() => {
                      onSelect(asset.id);
                      onOpenChange(false);
                    }}
                    className={cn(
                      'group relative block w-full overflow-hidden rounded-lg border-2 bg-muted text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected ? 'border-primary' : 'border-transparent hover:border-primary/40',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- kütüphane küçük resmi; optimize edici katmanı gereksiz. */}
                    <img
                      src={asset.url}
                      alt=""
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                    <span className="block truncate bg-card px-2 py-1.5 text-xs text-muted-foreground">
                      {name}
                    </span>
                    {selected ? (
                      <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check aria-hidden="true" className="size-3.5" />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
