'use client';

import { Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { t } from '@/i18n/tr';

/**
 * Tek bir DNS kaydı — üç ayrı kopyalama düğmesiyle.
 *
 * BATCH 11.6 KABUL KRİTERİ BU BİLEŞENDE: "kullanıcı DNS sağlayıcısına
 * yapıştırılacak değerleri elle YAZMAK ZORUNDA KALMAZ."
 *
 * Üç düğme, tek düğmeden iyi: DNS panellerinin çoğu tip/ad/değeri ayrı
 * alanlara istiyor ve birleşik bir kopya, kullanıcıyı elle bölmeye zorlardı —
 * yani tam da kaçındığımız şeye. `<code>` ögesi ayrıca seçilebilir: pano
 * erişimi olmayan ortamlarda (izin reddi, güvensiz bağlam) yedek yol.
 */
export function DnsRecord({
  type,
  name,
  value,
}: {
  type: string;
  name: string;
  value: string;
}): ReactNode {
  return (
    <div className="grid gap-2 rounded-md border border-border bg-muted p-3 sm:grid-cols-[6rem_1fr_1fr]">
      <CopyField label={t('domains.recordType')} value={type} />
      <CopyField label={t('domains.recordName')} value={name} />
      <CopyField label={t('domains.recordValue')} value={value} />
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano reddedildi — `<code>` zaten seçilebilir, kullanıcı elle kopyalar.
    }
  }

  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 text-xs" title={value}>
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`${label}: ${t('common.copy')}`}
          className="rounded p-1.5 text-muted-foreground hover:bg-card"
        >
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Duyuru ayrı bir canlı bölgede: ekran okuyucu "Kopyalandı" desin. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t('common.copied') : ''}
      </span>
    </div>
  );
}
