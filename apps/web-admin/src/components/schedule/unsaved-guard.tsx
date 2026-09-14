'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/i18n/tr';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Kaydedilmemiş değişiklik koruması.
 *
 * Üç çıkış yolu var ve üçü de ayrı ele alınıyor:
 *
 * 1. **Sekme kapatma / yenileme** — `beforeunload`. Tarayıcı kendi metnini
 *    gösteriyor; özel metin 2016'dan beri yok sayılıyor.
 * 2. **Panel içi bağlantı** (kenar çubuğu, üst çubuk) — App Router'da
 *    gezinmeyi durduracak bir olay yok. Belge düzeyinde, YAKALAMA evresinde
 *    iç bağlantı tıklamaları kesiliyor ve onaydan sonra `router.push` ile
 *    sürdürülüyor. Yeni sekme (Cmd/Ctrl/orta tık) ve dış bağlantılar
 *    kesilmiyor: onlar bu sayfayı kapatmıyor.
 * 3. **Sayfa içi yıkıcı eylem** (başka personele geçmek, taslağı atmak) —
 *    çağıran `guard(action)` ile sarıyor.
 *
 * Sekme değiştirmek korunmuyor: taslaklar sayfada tutulduğu için sekmeler
 * arası geçişte hiçbir şey kaybolmuyor, sormak yalnız sürtünme olurdu.
 */
export function useUnsavedGuard(dirty: boolean): {
  guard: (action: () => void) => void;
  dialog: ReactNode;
} {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty],
  );

  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }

    function onClick(event: MouseEvent): void {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target !== '' && anchor.target !== '_self') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => router.push(`${url.pathname}${url.search}${url.hash}`));
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, router]);

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('schedule.leaveTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('schedule.leaveBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('schedule.leaveCancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            onClick={() => {
              const action = pending;
              setPending(null);
              action?.();
            }}
          >
            {t('schedule.leaveConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { guard, dialog };
}
