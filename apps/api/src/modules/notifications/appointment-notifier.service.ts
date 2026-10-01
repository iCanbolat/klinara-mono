import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { toZonedIso } from '../../common/time';
import type { Tx } from '../../database/tenant-tx';
import { NotificationDispatcherService, type EnqueueResult } from './notification-dispatcher.service';
import * as repo from './reminders.repository';

/** Saat ŞUBENİN saat diliminde yazılır — müşteri klinikteki saati okur. */
export function formatAppointmentTime(appointment: repo.AppointmentSummary): string {
  const iso = toZonedIso(appointment.startsAt, appointment.branchTimezone);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

/** Randevu olaylarının tamamının kullandığı değişken seti. */
export function appointmentVariables(
  appointment: repo.AppointmentSummary,
): Record<string, string> {
  return {
    customerName: appointment.customerName,
    branchName: appointment.branchName,
    // Adres boşsa boş metin: şablon yer tutucusu eksik kalmasın.
    branchAddress: appointment.branchAddress ?? '',
    // "Haritada aç" butonunun eki: Meta'da alan adı sabit, adres URL kodlu eklenir.
    // Adres yoksa şube adı aranır.
    branchMapsQuery: encodeURIComponent(
      [appointment.branchName, appointment.branchAddress].filter(Boolean).join(' '),
    ),
    // Editörün sözleşmesinde yok ama eski kayıtlı şablonlarda geçiyor; değer
    // üretilmezse o şablon render edilemez ve randevu yazımı düşerdi. Şubenin
    // kendi bağlantısı yoksa aynı aramanın adresi.
    branchMapsUrl:
      appointment.branchMapsUrl ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        [appointment.branchName, appointment.branchAddress].filter(Boolean).join(' '),
      )}`,
    appointmentAt: formatAppointmentTime(appointment),
    serviceName: appointment.serviceNames.join(', '),
  };
}

const ACTIVE = new Set(['scheduled', 'confirmed']);

/**
 * Randevu oluşturma / iptal bildirimleri.
 *
 * Çağıranın transaction'ında çalışır: randevu yazımı geri alınırsa mesaj da
 * kuyruğa girmemiş olur. Geçmiş tarihli randevulara (geriye dönük kayıt) hiç
 * bildirim gitmez.
 */
@Injectable()
export class AppointmentNotifierService {
  private readonly logger = new Logger(AppointmentNotifierService.name);

  constructor(private readonly dispatcher: NotificationDispatcherService) {}

  /**
   * Bozuk bir şablon RANDEVUYU düşürmez, yalnız mesajı.
   *
   * Render hatası çağıranın transaction'ında fırlıyordu: kiracının şablonunda
   * karşılığı olmayan tek bir değişken, panelden ve randevu sayfasından
   * randevu almayı tümüyle kapatıyor, müşteri de anlamsız bir hata görüyordu.
   * Şablon hatası şablonu yazanın sorunu; kaydı günlüğe düşüp devam ediyoruz.
   */
  private async enqueueSafely(
    tx: Tx,
    tenantId: string,
    input: Parameters<NotificationDispatcherService['enqueue']>[2],
  ): Promise<EnqueueResult | null> {
    try {
      return await this.dispatcher.enqueue(tx, tenantId, input);
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.TEMPLATE_INVALID) {
        this.logger.warn(
          `${input.event} bildirimi atlandı (randevu ${input.appointmentId ?? '-'}): ${error.message}`,
        );
        return null;
      }
      throw error;
    }
  }

  async notifyCreated(
    tx: Tx,
    tenantId: string,
    appointmentId: string,
    now: Date = new Date(),
  ): Promise<EnqueueResult | null> {
    const appointment = await repo.findAppointmentSummary(tx, appointmentId);
    if (appointment === undefined || !ACTIVE.has(appointment.status)) return null;
    if (appointment.startsAt.getTime() <= now.getTime()) return null;

    return this.enqueueSafely(tx, tenantId, {
      event: 'appointment_confirmation',
      customerId: appointment.customerId,
      branchId: appointment.branchId,
      appointmentId: appointment.id,
      dedupeKey: `appointment_confirmation:${appointment.id}`,
      variables: appointmentVariables(appointment),
    });
  }

  /**
   * `version` tekillik anahtarına girer: iptal → yeniden aç → iptal zincirinde
   * ikinci iptal de bildirilir, aynı iptalin tekrarı bildirilmez.
   */
  async notifyCancelled(
    tx: Tx,
    tenantId: string,
    appointmentId: string,
    version: number,
    now: Date = new Date(),
  ): Promise<EnqueueResult | null> {
    const appointment = await repo.findAppointmentSummary(tx, appointmentId);
    if (appointment === undefined || appointment.status !== 'cancelled') return null;
    if (appointment.startsAt.getTime() <= now.getTime()) return null;

    return this.enqueueSafely(tx, tenantId, {
      event: 'appointment_cancelled',
      customerId: appointment.customerId,
      branchId: appointment.branchId,
      appointmentId: appointment.id,
      dedupeKey: `appointment_cancelled:${appointment.id}:${version}`,
      variables: appointmentVariables(appointment),
    });
  }
}
