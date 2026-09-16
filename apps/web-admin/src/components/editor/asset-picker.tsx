'use client';

import { ImageIcon, ImageOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AssetPurpose } from '@klinara/shared';
import { assetLabel, useAssetLibrary } from '@/lib/editor/use-asset-library';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';
import { AssetLibraryDialog } from './asset-library-dialog';

/**
 * Tek görsel alanı: seçili görselin önizlemesi, "Değiştir" ve "Kaldır".
 *
 * Listeleme/yükleme mekaniği `useAssetLibrary`de; seçim ve yükleme
 * `AssetLibraryDialog`da. Karusel öge editörü aynı ikiliyi kullanıyor, yani iki
 * yüzey aynı kütüphaneyi, aynı ön denetimi ve aynı hata metinlerini paylaşıyor.
 *
 * Kütüphanede bulunmayan bir kimlik (başka bir kullanıcının sildiği varlık)
 * sessizce boşaltılmıyor: "görsel bulunamadı" olarak gösteriliyor ve kullanıcı
 * açıkça değiştirene ya da kaldırana kadar doküman aynı kimliği taşıyor.
 */
export function AssetPicker({
  label,
  assetId,
  purpose = 'booking_hero',
  readOnly,
  onChange,
}: {
  label: string;
  assetId: string | null;
  purpose?: AssetPurpose;
  readOnly: boolean;
  onChange: (assetId: string | null) => void;
}): ReactNode {
  const library = useAssetLibrary();
  const [open, setOpen] = useState(false);
  const asset = assetId === null ? undefined : library.assets.find((candidate) => candidate.id === assetId);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {asset !== undefined ? (
            // eslint-disable-next-line @next/next/no-img-element -- küçük önizleme; optimize edici katmanı gereksiz.
            <img src={asset.url} alt="" className="h-full w-full object-cover" />
          ) : assetId !== null ? (
            <ImageOff aria-hidden="true" className="size-5 text-muted-foreground" />
          ) : (
            <ImageIcon aria-hidden="true" className="size-5 text-muted-foreground/60" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-xs text-muted-foreground">
            {asset !== undefined
              ? assetLabel(asset)
              : assetId !== null
                ? t('asset.missing')
                : '—'}
          </span>
          {readOnly ? null : (
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
                {assetId === null ? t('asset.choose') : t('asset.change')}
              </Button>
              {assetId !== null ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                  {t('asset.remove')}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {readOnly ? null : (
        <AssetLibraryDialog
          open={open}
          onOpenChange={setOpen}
          library={library}
          purpose={purpose}
          selectedId={assetId}
          onSelect={(id) => onChange(id)}
        />
      )}
    </div>
  );
}
