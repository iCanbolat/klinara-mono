'use client';

import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { useSession } from '@/components/session/session-provider';
import { can } from '@/lib/permissions';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStaffNotifications, type StaffNotification } from './use-staff-notifications';

/** "3 dk önce" — saat/tarih satırı listeyi gereksiz uzatıyordu. */
function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t('notifications.now');
  if (minutes < 60) return t('notifications.minutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('notifications.hoursAgo', { n: hours });
  return t('notifications.daysAgo', { n: Math.round(hours / 24) });
}

function Row({
  notification,
  onOpen,
}: {
  notification: StaffNotification;
  onOpen: (notification: StaffNotification) => void;
}): ReactNode {
  return (
    <DropdownMenuItem
      className="flex-col items-start gap-0.5"
      onSelect={() => onOpen(notification)}
    >
      <span className="flex w-full items-center gap-2">
        {notification.readAt === null ? (
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
        ) : null}
        <span className="truncate text-body-emphasis">{notification.title}</span>
      </span>
      {notification.body === null ? null : (
        <span className="w-full truncate text-xs text-muted-foreground">{notification.body}</span>
      )}
      <span className="text-xs text-muted-foreground">{relativeTime(notification.createdAt)}</span>
    </DropdownMenuItem>
  );
}

/**
 * Panelin zil ikonu.
 *
 * Bildirimler açılınca DEĞİL, tıklanınca okundu sayılıyor: menüyü kazara açan
 * biri bekleyen işleri sayaçtan silmiş olmamalı. "Tümünü okundu işaretle" ayrı
 * ve açık bir eylem.
 */
export function NotificationBell(): ReactNode {
  const { permissions } = useSession();
  const router = useRouter();
  const allowed = can(permissions, PERMISSIONS.NOTIFICATION_READ);
  const { notifications, unreadCount, error, markRead } = useStaffNotifications(allowed);

  if (!allowed) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={
          unreadCount === 0
            ? t('notifications.title')
            : t('notifications.unreadLabel', { n: unreadCount })
        }
        className="relative flex size-9 cursor-pointer items-center justify-center rounded-lg hover:bg-muted"
      >
        <Bell aria-hidden="true" className="size-5" />
        {unreadCount === 0 ? null : (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>{t('notifications.title')}</span>
          {unreadCount === 0 ? null : (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => markRead()}
            >
              {t('notifications.markAllRead')}
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {error !== null ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{error}</p>
        ) : notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t('notifications.empty')}
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            {notifications.map((notification) => (
              <Row
                key={notification.id}
                notification={notification}
                onOpen={(row) => {
                  if (row.readAt === null) markRead([row.id]);
                  // Yönlendirme `Link` ile DEĞİL: menü kapanırken bağlantının
                  // tıklaması kayboluyor ve satır okundu olup yerinde kalıyordu.
                  if (row.link !== null) router.push(row.link);
                }}
              />
            ))}
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
