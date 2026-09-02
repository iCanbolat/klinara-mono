'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Tutma süresi geri sayımı.
 *
 * Kalan süre STATE DEĞİL, TÜREV: state yalnız "şu an" damgasını tutuyor ve
 * kalan saniye her render'da `expiresAt - now` ile hesaplanıyor. İki kazanç:
 *
 * 1. **Tick birikmiyor.** Sayaçtan bir çıkarsaydık, arka plana alınmış bir
 *    sekmede (tarayıcılar `setInterval`i kısıyor) sayaç gerçek zamandan
 *    sapardı — kullanıcı "3 dakika var" görürken slot çoktan serbest kalmış
 *    olurdu.
 * 2. `expiresAt` değişince ek bir state sıfırlaması gerekmiyor; türev değer
 *    kendiliğinden doğru.
 *
 * `expiresAt` her zaman SUNUCUDAN gelir ve otoritedir; istemci saatinin
 * kayması yalnız gösterimi etkiler, kararı değil (sunucu `expires_at`i her
 * okumada kontrol ediyor).
 */
export function useHoldCountdown(
  expiresAt: string | null,
  onExpire: () => void,
): { secondsLeft: number | null; isExpiring: boolean } {
  const [now, setNow] = useState(() => Date.now());

  /**
   * `onExpire` REF'te tutuluyor: aksi hâlde hook, her çağıranı callback'ini
   * `useCallback` ile sabitlemeye zorlardı ve sabitlenmemiş bir callback
   * süre dolduğunda her render'da yeniden tetiklenirdi. Sabitleme yükünü
   * çağırana yıkmak yerine hook kendi içinde çözüyor.
   */
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (expiresAt === null) return;

    const tick = (): void => {
      setNow(Date.now());
    };
    const timer = window.setInterval(tick, 1000);
    // Sekmeye dönüşte ANINDA kontrol: beklenmezse kullanıcı bir tick boyunca
    // ölü bir sayaç görür.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [expiresAt]);

  const deadline = expiresAt === null ? null : new Date(expiresAt).getTime();
  const secondsLeft =
    deadline === null || Number.isNaN(deadline)
      ? null
      : Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    if (secondsLeft === 0) onExpireRef.current();
  }, [secondsLeft]);

  return {
    secondsLeft,
    // Son bir dakikada uyarı: kullanıcı bir sonraki adımda değil, SAYAÇ
    // bitmeden önce haberdar olmalı.
    isExpiring: secondsLeft !== null && secondsLeft <= 60 && secondsLeft > 0,
  };
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
