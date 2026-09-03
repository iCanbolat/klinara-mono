'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Asset, AssetPurpose, PresignAssetResponse } from '@klinara/shared';
import { api } from '@/lib/api/client';
import { ACCEPT_ATTRIBUTE, checkAsset, MAX_MEGABYTES } from '@/lib/editor/asset-rules';
import { t } from '@/i18n/tr';

export { ACCEPT_ATTRIBUTE };

/**
 * Varlık kütüphanesi — listeleme ve yükleme, TEK yerde.
 *
 * `AssetPicker` ve karusel öge editörü aynı işi yapıyor; ikisi de kendi
 * `useEffect`ini yazsaydı 20 ögelik bir karusel 20 kez `GET
 * booking-page/assets` çağırırdı. Kanca listeyi çağıran başına bir kez okuyor.
 *
 * ⚠️ DOSYA PROXY'DEN GEÇMİYOR. `presign` ile alınan imzalı adrese tarayıcı
 * DOĞRUDAN `PUT` ediyor; 5 MB'lık bir gövdeyi Next sunucusundan geçirmek saf
 * israf olurdu. Bunun altyapı bedeli var: bucket CORS'unun yönetim origin'inden
 * `PUT`a izin vermesi gerekiyor.
 *
 * Ön denetim (`checkAsset`) sunucununkini tekrar ediyor gibi görünse de amacı
 * farklı: kullanıcıya dosyayı YÜKLEDİKTEN sonra değil, SEÇERKEN söylemek.
 */
export interface AssetLibrary {
  assets: readonly Asset[];
  uploading: boolean;
  error: string | null;
  /** Yükler ve YENİ varlığın kimliğini döner; başarısızlıkta `null`. */
  upload: (file: File, purpose: AssetPurpose) => Promise<string | null>;
  dismissError: () => void;
}

export function useAssetLibrary(): AssetLibrary {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void api
      .get<Asset[]>('booking-page/assets')
      .then(setAssets)
      .catch(() => setAssets([]));
  }, []);

  const upload = useCallback(async (file: File, purpose: AssetPurpose): Promise<string | null> => {
    const rejection = checkAsset(file);
    if (rejection !== null) {
      setError(
        rejection === 'svg'
          ? t('asset.svgRejected')
          : rejection === 'too-large'
            ? t('asset.tooLarge', { mb: MAX_MEGABYTES })
            : t('asset.wrongType'),
      );
      return null;
    }

    setUploading(true);
    setError(null);
    try {
      const presigned = await api.post<PresignAssetResponse>('booking-page/assets/presign', {
        purpose,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error('upload failed');

      const confirmed = await api.post<Asset>('booking-page/assets/confirm', {
        storageKey: presigned.storageKey,
        purpose,
      });
      setAssets((current) => [confirmed, ...current]);
      return confirmed.id;
    } catch {
      setError(t('error.network'));
      return null;
    } finally {
      setUploading(false);
    }
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { assets, uploading, error, upload, dismissError };
}

/** Seçim kutusunda gösterilecek ad — alternatif metin yoksa kimliğin başı. */
export function assetLabel(asset: Asset): string {
  return asset.altText ?? asset.id.slice(0, 8);
}
