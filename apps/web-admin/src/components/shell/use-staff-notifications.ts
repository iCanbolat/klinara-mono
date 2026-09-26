'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
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
 * Bildirim yoklaması — sohbet listesiyle aynı kalıp (`use-conversations`):
 * sunucuda yayın altyapısı yok, sekme gizliyken yoklama duruyor.
 */
const POLL_MS = 30_000;

export interface StaffNotificationsState {
  notifications: StaffNotification[];
  unreadCount: number;
  error: string | null;
  markRead: (ids?: string[]) => void;
}

export function useStaffNotifications(enabled: boolean): StaffNotificationsState {
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
        setFeed(page);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [enabled, nonce]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, POLL_MS);
    const onVisible = (): void => {
      if (!document.hidden) reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, reload]);

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
