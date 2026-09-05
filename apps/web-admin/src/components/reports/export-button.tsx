'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/tr';
import { downloadFile } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';

/**
 * CSV indirme düğmesi.
 *
 * `<a href download>` DEĞİL: uç `POST` (gövde bir filtre taşıyor) ve oturum
 * bitmişse bir anchor sessizce giriş sayfasının HTML'ini `.csv` diye indirirdi.
 * `downloadFile` olağan 401/yenileme yolundan geçiyor.
 */

interface Props {
  /** Proxy yolu, `/api/a/` sonrası — örn. `reports/revenue/export`. */
  path: string;
  /** Sunucuya gidecek filtre; rapor sorgusunun aynısı. */
  body: Record<string, unknown>;
  branchId?: string | undefined;
}

export function ExportButton({ path, body, branchId }: Props): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Şube GÖVDEYE de konuyor: dışa aktarım uçları raporun kendisiyle aynı
      // DTO'yu alıyor ve kapsamı `body.branchId`den çözüyor. Başlık tek başına
      // bırakılsaydı CSV, ekranda görünen şubeden farklı bir kapsam taşırdı.
      await downloadFile(
        path,
        branchId === undefined ? body : { ...body, branchId },
        branchId === undefined ? {} : { branchId },
      );
    } catch (caught) {
      // `toMessage` oturum bitişinde `null` dönüyor: onu provider bir MODAL
      // olarak gösteriyor, düğmenin altında ikinci bir kırmızı satır olarak
      // değil.
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>
        {busy ? t('reports.exporting') : t('reports.export')}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
