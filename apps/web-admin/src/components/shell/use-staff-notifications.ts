'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api/client';
import { emitMessageEvent } from '@/lib/messages/message-events';
import {
  isRealtimeConnected,
  onRealtimeStatus,
  subscribeRealtime,
} from '@/lib/realtime/realtime-client';
import { toMessage } from '@/lib/reports/errors';

export type StaffNotificationKind =
  | 'appointment_created'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'inbound_message'
  | 'delivery_failed';

export interface StaffNotification {
  id: string;
  kind: StaffNotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

interface Feed {
  data: StaffNotification[];
  unreadCount: number;
}

/**
 * Bildirimler soketten ANINDA tetikleniyor (`realtime-client`); yoklama yalnız
 * güvenlik ağı. Soket bağlıyken seyrek, kopukken sık — sekme gizliyken duruyor.
 */
const POLL_MS = 15_000;
const POLL_CONNECTED_MS = 60_000;

export interface StaffNotificationsState {
  notifications: StaffNotification[];
  unreadCount: number;
  error: string | null;
  markRead: (ids?: string[]) => void;
}

export function useStaffNotifications(
  enabled: boolean,
  onNew?: (fresh: StaffNotification[]) => void,
): StaffNotificationsState {
  // İlk yükleme toast basmaz (oturum açılışında eski okunmamışlar yağmasın);
  // sonrasında yalnız daha önce görülmemiş VE okunmamış satırlar bildirilir.
  const seen = useRef<Set<string> | null>(null);
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  });
  const [feed, setFeed] = useState<Feed>({ data: [], unreadCount: 0 });
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const page = await api.get<Feed>('staff-notifications?limit=20', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const known = seen.current;
        seen.current = new Set(page.data.map((row) => row.id));
        if (known !== null) {
          const fresh = page.data.filter((row) => row.readAt === null && !known.has(row.id));
          if (fresh.length > 0) onNewRef.current?.(fresh);
          if (fresh.some((row) => row.kind === 'inbound_message' || row.kind === 'delivery_failed'))
            emitMessageEvent();
        }
        setFeed(page);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [enabled, nonce]);

  // Soket içerik taşımıyor: olay gelince akış yeniden okunuyor, toast ve
  // sayaç yukarıdaki fark hesabından çıkıyor.
  const live = useSyncExternalStore(onRealtimeStatus, isRealtimeConnected, () => false);
  useEffect(() => {
    if (!enabled) return;
    return subscribeRealtime((message) => {
      // Sohbet ekranı zil akışını beklemeden tazelensin.
      if (
        message.type === 'staff_notification' &&
        (message.kind === 'inbound_message' || message.kind === 'delivery_failed')
      )
        emitMessageEvent();
      reload();
    });
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(
      () => {
        if (!document.hidden) reload();
      },
      live ? POLL_CONNECTED_MS : POLL_MS,
    );
    const onVisible = (): void => {
      if (!document.hidden) reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, live, reload]);

  const markRead = useCallback(
    (ids?: string[]) => {
      // Sayaç ANINDA düşer; sunucu yanıtı beklenmez. Yazma başarısız olursa
      // sonraki yoklama gerçeği geri getirir.
      setFeed((current) => ({
        data: current.data.map((row) =>
          ids === undefined || ids.includes(row.id)
            ? { ...row, readAt: row.readAt ?? new Date().toISOString() }
            : row,
        ),
        unreadCount:
          ids === undefined
            ? 0
            : current.data.filter((row) => row.readAt === null && !ids.includes(row.id)).length,
      }));
      void api
        .post('staff-notifications/read', ids === undefined ? {} : { ids })
        .catch(() => reload());
    },
    [reload],
  );

  return { notifications: feed.data, unreadCount: feed.unreadCount, error, markRead };
}
