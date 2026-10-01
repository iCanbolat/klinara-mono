'use client';

import {
  CalendarClockIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  MessageCircleIcon,
  MessageSquareWarningIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n/tr';
import type { StaffNotification, StaffNotificationKind } from './use-staff-notifications';

/**
 * Her bildirim türünün KENDİ toast stili: ikon + ton (uygulama token'larından).
 * Ton `--tone` değişkeniyle geçiyor; zemin/kenarlık/ikon karosu ondan türüyor.
 */
const KIND_STYLE: Record<StaffNotificationKind, { icon: LucideIcon; tone: string }> = {
  appointment_created: { icon: CalendarPlusIcon, tone: 'var(--success)' },
  appointment_rescheduled: { icon: CalendarClockIcon, tone: 'var(--link)' },
  appointment_cancelled: { icon: CalendarXIcon, tone: 'var(--warning)' },
  inbound_message: { icon: MessageCircleIcon, tone: 'var(--chart-4)' },
  delivery_failed: { icon: MessageSquareWarningIcon, tone: 'var(--destructive)' },
};

function NotificationToast({
  toastId,
  notification,
  onOpen,
}: {
  toastId: string | number;
  notification: StaffNotification;
  onOpen: (() => void) | null;
}): ReactNode {
  const { icon: Icon, tone } = KIND_STYLE[notification.kind];
  return (
    <div
      role="status"
      style={{ '--tone': tone } as CSSProperties}
      className="relative flex w-[356px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border border-[color-mix(in_oklab,var(--tone)_28%,white)] bg-[color-mix(in_oklab,var(--tone)_8%,white)] p-3.5 pr-9 font-sans shadow-lg"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--tone)_16%,white)] text-[var(--tone)]"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{notification.title}</p>
        {notification.body === null ? null : (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
        )}
        {onOpen === null ? null : (
          <button
            type="button"
            onClick={() => {
              toast.dismiss(toastId);
              onOpen();
            }}
            className="mt-2 cursor-pointer rounded-md bg-[var(--tone)] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            {t('notifications.open')}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label={t('notifications.close')}
        onClick={() => toast.dismiss(toastId)}
        className="absolute top-2 right-2 flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-[color-mix(in_oklab,var(--tone)_14%,white)]"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function showNotificationToast(
  notification: StaffNotification,
  onOpen: (() => void) | null,
): void {
  toast.custom(
    (id) => <NotificationToast toastId={id} notification={notification} onOpen={onOpen} />,
    { id: notification.id, duration: 8000 },
  );
}
