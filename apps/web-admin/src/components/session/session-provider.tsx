'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Me } from '@klinara/shared';
import {
  clearSessionExpiry,
  noteSessionExpiry,
  onSessionExpired,
  refreshSession,
} from '@/lib/api/client';
import { SessionExpiredDialog } from './session-expired-dialog';

/**
 * Oturum durumunu tutan ve PROAKTİF yenilemeyi planlayan sağlayıcı.
 *
 * Yenileme neden proaktif: reaktif yenileme (401 gör, yenile, tekrar dene)
 * çalışıyor ama her seferinde bir isteğin başarısız olmasını gerektiriyor.
 * `exp − 60s`te tazelemek, kullanıcının 401 üreten bir isteği hiç görmemesi
 * demek — ve 401 yolunun nadir olması, oradaki bir hatanın nadir olması
 * anlamına da geliyor.
 */

interface SessionState {
  me: Me | null;
  loading: boolean;
  permissions: string[];
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession yalnız SessionProvider içinde kullanılabilir.');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/session/me', { credentials: 'same-origin' });
      if (response.status === 401) {
        clearSessionExpiry();
        setMe(null);
        setExpired(true);
        return;
      }
      if (!response.ok) return;
      setMe((await response.json()) as Me);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Oturumun öldüğünü `client.ts` duyuruyor; modal buradan açılıyor.
  useEffect(() => onSessionExpired(() => setExpired(true)), []);

  /**
   * Proaktif yenileme zamanlayıcısı.
   *
   * ⚠️ Zamanlayıcı BİRİKTİRİLMİYOR, her seferinde yeniden kuruluyor: arka plana
   * alınmış bir sekmede tarayıcı `setTimeout`u kısıyor ve biriktirilmiş bir
   * sayaç gerçek zamandan sapardı. Ayrıca sekmeye dönüşte anında kontrol
   * ediliyor — web-booking'deki geri sayım kararının aynısı.
   */
  useEffect(() => {
    if (me === null) return;

    const schedule = (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      // 12 dakika: erişim token'ı 15 dakikalık, 60 saniyelik pay bırakılıyor.
      timerRef.current = setTimeout(() => void refreshSession(), 12 * 60 * 1000);
    };
    schedule();

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [me]);

  const value = useMemo<SessionState>(
    () => ({
      me,
      loading,
      permissions: me?.permissions ?? [],
      reload: load,
    }),
    [me, loading, load],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {expired ? (
        <SessionExpiredDialog
          email={me?.user.email ?? ''}
          onRecovered={(expiresIn) => {
            noteSessionExpiry(expiresIn);
            setExpired(false);
            void load();
          }}
        />
      ) : null}
    </SessionContext.Provider>
  );
}
