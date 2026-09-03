'use client';

import type { ChangeEvent, ReactNode } from 'react';
import { assetLabel, useAssetLibrary, ACCEPT_ATTRIBUTE } from '@/lib/editor/use-asset-library';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';

/**
 * Tek görsel seçimi ve yükleme.
 *
 * Listeleme/yükleme mekaniği `useAssetLibrary`de; burada kalan yalnız tek
 * alanlık sunum. Karusel öge editörü aynı kancayı kullanıyor ve böylece iki
 * yüzey aynı kütüphaneyi, aynı ön denetimi ve aynı hata metinlerini paylaşıyor.
 */
export function AssetPicker({
  label,
  assetId,
  readOnly,
  onChange,
}: {
  label: string;
  assetId: string | null;
  readOnly: boolean;
  onChange: (assetId: string | null) => void;
}): ReactNode {
  const library = useAssetLibrary();

  async function upload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    const uploaded = await library.upload(file, 'booking_hero');
    if (uploaded !== null) onChange(uploaded);
    event.target.value = '';
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>

      <select
        value={assetId ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        disabled={readOnly}
        aria-label={label}
        className="h-10 rounded-md border border-line-strong bg-card px-2 text-sm"
      >
        <option value="">— yok —</option>
        {library.assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {assetLabel(asset)}
          </option>
        ))}
      </select>

      {readOnly ? null : (
        <input
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => void upload(event)}
          disabled={library.uploading}
          aria-label={t('asset.upload')}
          className="text-xs text-ink-soft"
        />
      )}
      {library.uploading ? <p className="text-xs text-ink-soft">{t('asset.uploading')}</p> : null}
      {library.error !== null ? <Alert tone="danger">{library.error}</Alert> : null}
    </div>
  );
}
