import { PERMISSIONS, type AppointmentStatus } from '@klinara/shared';
import type { AlertTone } from '@/components/ui/alert';
import type { MessageKey } from '@/i18n/tr';

/**
 * Randevu durumunun görünümü ve izin verilen geçişler.
 *
 * `lib/domains/status.ts`in kalıbı: **sunucudan öğrenilen kuralı istemcide de
 * bilmek, düğmeyi ETKİSİZLEŞTİRMEK için**. Kullanıcıya bir düğme gösterip
 * arkasından 409 `INVALID_STATUS_TRANSITION` yedirmek, ona sistemin
 * kurallarını hata mesajlarıyla öğretmektir.
 *
 * ⚠️ Buradaki tablo sunucunun `appointment_status_transitions` TABLOSUNUN
 * kopyasıdır (`0018_phase3_appointments.sql`). Kopya olduğu için ayrışabilir;
 * ama ayrışmanın yönü GÜVENLİ: burada eksik bir geçiş "düğme yok" demek,
 * fazladan bir geçiş ise sunucunun reddedeceği bir düğme demek. İkisi de
 * veri bozmaz — sunucu son sözü söylüyor.
 */

export const STATUS_TONE: Record<AppointmentStatus, AlertTone> = {
  scheduled: 'info',
  confirmed: 'ok',
  arrived: 'ok',
  in_progress: 'ok',
  completed: 'ok',
  no_show: 'warn',
  cancelled: 'danger',
};

export const STATUS_LABEL: Record<AppointmentStatus, MessageKey> = {
  scheduled: 'calendar.status.scheduled',
  confirmed: 'calendar.status.confirmed',
  arrived: 'calendar.status.arrived',
  in_progress: 'calendar.status.inProgress',
  completed: 'calendar.status.completed',
  no_show: 'calendar.status.noShow',
  cancelled: 'calendar.status.cancelled',
};

interface Transition {
  to: AppointmentStatus;
  /** Gerekliyse ek izin — `completed`ten çıkış `appointment:reopen` ister. */
  permission?: string;
}

/**
 * `0018_phase3_appointments.sql:171-187` ile birebir.
 *
 * `cancelled` ve `no_show` KAYNAK olarak yok: ikisi de terminal. İptal edilen
 * bir randevu geri açılmaz — yenisi oluşturulur; `resource_bookings` satırı
 * zaten `active=false` yapılmış ve slot serbest kalmıştır.
 */
const TRANSITIONS: Record<AppointmentStatus, readonly Transition[]> = {
  scheduled: [
    { to: 'confirmed' },
    { to: 'arrived' },
    { to: 'no_show' },
    { to: 'cancelled' },
  ],
  confirmed: [{ to: 'arrived' }, { to: 'no_show' }, { to: 'cancelled' }],
  arrived: [{ to: 'in_progress' }, { to: 'no_show' }, { to: 'cancelled' }],
  in_progress: [{ to: 'completed' }, { to: 'cancelled' }],
  completed: [
    // Tamamlanmış randevuya dokunmak ayrı bir yetki: seans hakkı tüketilmiş,
    // hizmet bedeli yazılmış olabilir ve geri almak TERS KAYIT üretir.
    { to: 'in_progress', permission: PERMISSIONS.APPOINTMENT_REOPEN },
    { to: 'cancelled', permission: PERMISSIONS.APPOINTMENT_REOPEN },
  ],
  no_show: [],
  cancelled: [],
};

export interface StatusAction {
  to: AppointmentStatus;
  labelKey: MessageKey;
  /** İzin yetersizse `false` — düğme GÖSTERİLİYOR ama etkisiz. */
  allowed: boolean;
  /** Etkisizse sebebi; `title` olarak basılıyor. */
  reasonKey: MessageKey | undefined;
}

/**
 * Bu durumdan gidilebilecek durumlar ve her birinin etkin olup olmadığı.
 *
 * İzinsiz geçiş LİSTEDEN ÇIKARILMIYOR, etkisizleştiriliyor. Gerekçe:
 * `completed` bir randevuda "geri al" düğmesinin hiç görünmemesi, uygulayıcıya
 * "böyle bir şey yapılamaz" der. Etkisiz ve sebebi yazılı bir düğme ise
 * "yapılabilir ama sizin yetkiniz yok" der — doğru olan bu.
 */
export function statusActions(
  current: AppointmentStatus,
  permissions: readonly string[],
): StatusAction[] {
  return TRANSITIONS[current].map((transition) => {
    const allowed =
      transition.permission === undefined || permissions.includes(transition.permission);
    return {
      to: transition.to,
      labelKey: STATUS_LABEL[transition.to],
      allowed,
      reasonKey: allowed ? undefined : 'calendar.status.reopenDenied',
    };
  });
}

/** Terminal durum — hiçbir geçiş kalmamış. */
export function isTerminal(status: AppointmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Randevu hâlâ takvimde YER KAPLIYOR mu.
 *
 * `cancelled` ve `no_show` sunucuda `resource_bookings.active = false`
 * yapıyor, yani slot serbest. Izgarada bunları normal blok gibi çizmek,
 * dolu olmayan bir saati dolu göstermek olurdu.
 */
export function occupiesSlot(status: AppointmentStatus): boolean {
  return status !== 'cancelled' && status !== 'no_show';
}
