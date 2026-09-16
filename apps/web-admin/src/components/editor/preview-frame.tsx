'use client';

import { ExternalLink, Monitor, RotateCw, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { publicEnv } from '@/config/env';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';

/**
 * Canlı önizleme iframe'i.
 *
 * ⚠️ İMZALI TOKEN YOK. iframe web-booking'in `/preview.frame` rotasını yüklüyor ve
 * veriyi `postMessage` ile alıyor; yani iframe hiçbir kimlik bilgisi taşımıyor
 * ve hiçbir yetkili çağrı yapmıyor. Bir önizleme token'ı olsaydı ömrü, iptali
 * ve iki uygulama arasında paylaşılan bir imza anahtarı da olurdu.
 *
 * ⚠️ EL SIKIŞMA ŞART. iframe henüz yüklenmemişken gönderilen ilk mesaj
 * kaybolur — `/preview.frame` hazır olduğunda `klinara-preview-ready` yolluyor ve
 * asıl gönderim ondan sonra başlıyor. Bunu atlamak "önizleme ilk açılışta boş,
 * bir düzenleme yapınca geliyor" davranışı üretirdi.
 *
 * Hedef origin `postMessage`de AÇIKÇA veriliyor (`'*'` değil): taslak içerik
 * kiracının yayınlamadığı metin ve onu rastgele bir origin'e yollamak sızıntı.
 *
 * Mobil görünüm iframe'i 390 px'e daraltıyor: bloklar web-booking'in kendi
 * kırılım noktalarıyla çiziliyor, yani editördeki görüntü telefondaki sayfanın
 * ta kendisi. "Yenile" iframe'i yeniden kuruyor ve el sıkışmayı baştan yapıyor.
 */
type Device = 'desktop' | 'mobile';

export function PreviewFrame({
  payload,
  liveUrl,
}: {
  payload: unknown;
  /** Yayındaki sayfanın adresi; site yayında değilse `null`. */
  liveUrl: string | null;
}): ReactNode {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [generation, setGeneration] = useState(0);
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
      <p className="p-4 text-sm text-muted-foreground">
        Önizleme yapılandırılmamış (NEXT_PUBLIC_BOOKING_PREVIEW_ORIGIN).
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('editor.preview')}
        </span>
        <div className="flex items-center gap-1">
          <div role="group" aria-label={t('editor.preview')} className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <ToolbarButton
              pressed={device === 'desktop'}
              label={t('editor.previewDesktop')}
              onClick={() => setDevice('desktop')}
            >
              <Monitor aria-hidden="true" className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              pressed={device === 'mobile'}
              label={t('editor.previewMobile')}
              onClick={() => setDevice('mobile')}
            >
              <Smartphone aria-hidden="true" className="size-4" />
            </ToolbarButton>
          </div>
          <ToolbarButton
            label={t('editor.previewReload')}
            onClick={() => {
              setReady(false);
              setGeneration((current) => current + 1);
            }}
          >
            <RotateCw aria-hidden="true" className="size-4" />
          </ToolbarButton>
          {liveUrl !== null ? (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t('editor.openLive')}
              title={t('editor.openLive')}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 justify-center">
        <iframe
          key={generation}
          ref={frameRef}
          src={`${origin}/preview.frame`}
          title={t('editor.preview')}
          // `sandbox`: önizlenen içerik kiracının yazdığı metin. Script'e izin
          // veriliyor (renderer bir React uygulaması) ama `allow-top-navigation`
          // YOK — iframe içindeki bir şey yönetim panelini başka yere götüremesin.
          sandbox="allow-scripts allow-same-origin"
          className={cn(
            'h-full rounded-xl border border-border bg-white shadow-sm transition-[width] duration-300',
            device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full',
          )}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground',
        pressed === true ? 'bg-accent text-foreground' : 'hover:bg-card',
      )}
    >
      {children}
    </button>
  );
}
