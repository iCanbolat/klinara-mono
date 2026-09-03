'use client';

import { useEffect, useState } from 'react';
import type { PublicSitePayload, PublicCategory } from '@klinara/shared';
import { RenderBlocks } from '@/components/blocks/registry';
import { themeVariables } from '@/lib/theme';
import { publicEnv } from '@/config/env';

/**
 * Yönetim panelinin önizleme iframe'i.
 *
 * NEDEN BURADA, neden web-admin kendi renderer'ını yazmıyor: bloklar bu
 * uygulamanın SUNUCU bileşenleri ve `globals.css`teki özel özelliklere bağlı.
 * İkinci bir renderer, "önizlemede güzeldi ama yayında bozuk" sınıfı hataların
 * kaynağıdır — önizleme, ziyaretçinin göreceği kodun ta kendisi olmalı.
 *
 * NEDEN İMZALI TOKEN YOK: veri `postMessage` ile geliyor, yani bu sayfa hiçbir
 * kimlik bilgisi taşımıyor ve hiçbir yetkili çağrı yapmıyor. Yetki tamamen
 * web-admin tarafında kalıyor; burası saf bir renderer. Bir token olsaydı
 * ömrü, iptali ve iki uygulama arasında paylaşılan bir imza anahtarı da olurdu.
 *
 * ⚠️ `event.origin` kontrolü bu dosyanın TEK güvenlik önlemi. Olmasaydı
 * herhangi bir site bu rotayı iframe'e alıp içine keyfî içerik post edebilir
 * ve kiracının alan adı altında sahte bir sayfa gösterebilirdi.
 */

interface PreviewMessage {
  kind: 'klinara-preview';
  site: PublicSitePayload;
  categories: PublicCategory[];
}

export default function PreviewPage(): React.ReactElement {
  const [payload, setPayload] = useState<PreviewMessage | null>(null);
  const adminOrigin = publicEnv.adminOrigin;

  useEffect(() => {
    if (adminOrigin === '') return;

    function onMessage(event: MessageEvent): void {
      if (event.origin !== adminOrigin) return;
      const data = event.data as Partial<PreviewMessage> | null;
      if (data === null || data.kind !== 'klinara-preview' || data.site === undefined) return;
      setPayload({ kind: 'klinara-preview', site: data.site, categories: data.categories ?? [] });
    }

    window.addEventListener('message', onMessage);
    // Editöre "hazırım" de: iframe yüklenmeden gönderilen ilk mesaj kaybolurdu.
    window.parent.postMessage({ kind: 'klinara-preview-ready' }, adminOrigin);
    return () => window.removeEventListener('message', onMessage);
  }, [adminOrigin]);

  // Tema değişkenleri kök ögeye yazılıyor: bloklar onları CSS custom property
  // olarak okuyor ve bu, yayınlanmış sayfadaki mekanizmanın aynısı.
  useEffect(() => {
    if (payload === null) return;
    const variables = themeVariables(payload.site.theme);
    for (const [name, value] of Object.entries(variables) as [string, string][]) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [payload]);

  if (adminOrigin === '') {
    // Yönetim origin'i yapılandırılmamış — bu rotanın var olmasının sebebi yok.
    return <p style={{ padding: 24 }}>Önizleme bu ortamda kapalı.</p>;
  }

  if (payload === null) {
    return <p style={{ padding: 24 }}>Önizleme yükleniyor…</p>;
  }

  return (
    <main>
      <RenderBlocks
        sections={payload.site.sections}
        ctx={{ site: payload.site, categories: payload.categories }}
      />
    </main>
  );
}
