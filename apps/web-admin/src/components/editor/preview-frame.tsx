'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { publicEnv } from '@/config/env';
import { t } from '@/i18n/tr';

/**
 * Canlı önizleme iframe'i.
 *
 * ⚠️ İMZALI TOKEN YOK. iframe web-booking'in `/_preview` rotasını yüklüyor ve
 * veriyi `postMessage` ile alıyor; yani iframe hiçbir kimlik bilgisi taşımıyor
 * ve hiçbir yetkili çağrı yapmıyor. Bir önizleme token'ı olsaydı ömrü, iptali
 * ve iki uygulama arasında paylaşılan bir imza anahtarı da olurdu.
 *
 * ⚠️ EL SIKIŞMA ŞART. iframe henüz yüklenmemişken gönderilen ilk mesaj
 * kaybolur — `/_preview` hazır olduğunda `klinara-preview-ready` yolluyor ve
 * asıl gönderim ondan sonra başlıyor. Bunu atlamak "önizleme ilk açılışta boş,
 * bir düzenleme yapınca geliyor" davranışı üretirdi.
 *
 * Hedef origin `postMessage`de AÇIKÇA veriliyor (`'*'` değil): taslak içerik
 * kiracının yayınlamadığı metin ve onu rastgele bir origin'e yollamak sızıntı.
 */
export function PreviewFrame({ payload }: { payload: unknown }): ReactNode {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const origin = publicEnv.bookingPreviewOrigin;

  useEffect(() => {
    if (origin === '') return;
    function onMessage(event: MessageEvent): void {
      if (event.origin !== origin) return;
      const data = event.data as { kind?: string } | null;
      if (data?.kind === 'klinara-preview-ready') setReady(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin]);

  useEffect(() => {
    if (!ready || payload === null || origin === '') return;
    frameRef.current?.contentWindow?.postMessage({ kind: 'klinara-preview', ...(payload as object) }, origin);
  }, [ready, payload, origin]);

  if (origin === '') {
    return (
      <p className="p-4 text-sm text-ink-soft">
        Önizleme yapılandırılmamış (NEXT_PUBLIC_BOOKING_PREVIEW_ORIGIN).
      </p>
    );
  }

  return (
    <iframe
      ref={frameRef}
      src={`${origin}/_preview`}
      title={t('editor.preview')}
      // `sandbox`: önizlenen içerik kiracının yazdığı metin. Script'e izin
      // veriliyor (renderer bir React uygulaması) ama `allow-top-navigation`
      // YOK — iframe içindeki bir şey yönetim panelini başka yere götüremesin.
      sandbox="allow-scripts allow-same-origin"
      className="h-full w-full rounded-md border border-line bg-white"
    />
  );
}
