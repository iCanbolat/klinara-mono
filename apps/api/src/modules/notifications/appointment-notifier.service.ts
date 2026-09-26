import { Injectable } from '@nestjs/common';
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
  constructor(private readonly dispatcher: NotificationDispatcherService) {}

  async notifyCreated(
    tx: Tx,
    tenantId: string,
    appointmentId: string,
    now: Date = new Date(),
  ): Promise<EnqueueResult | null> {
    const appointment = await repo.findAppointmentSummary(tx, appointmentId);
    if (appointment === undefined || !ACTIVE.has(appointment.status)) return null;
    if (appointment.startsAt.getTime() <= now.getTime()) return null;

    return this.dispatcher.enqueue(tx, tenantId, {
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

    return this.dispatcher.enqueue(tx, tenantId, {
      event: 'appointment_cancelled',
      customerId: appointment.customerId,
      branchId: appointment.branchId,
      appointmentId: appointment.id,
      dedupeKey: `appointment_cancelled:${appointment.id}:${version}`,
      variables: appointmentVariables(appointment),
    });
  }
}
