import { Injectable } from '@nestjs/common';
import type { Tx } from '../../database/tenant-tx';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import * as repo from './reminders.repository';

/** Randevunun hatırlatma üretebildiği durumlar. */
const REMINDABLE = new Set(['scheduled', 'confirmed']);

/**
 * Randevu hatırlatmalarının planlanması.
 *
 * ⚠️ Bütün metotlar ÇAĞIRANIN transaction'ını alır ve iş kuyruğuna da o
 * transaction üzerinden yazar. Randevu rollback olursa hatırlatma satırı da
 * pg-boss işi de yazılmaz (mimari karar 4.6) — atomiklik ayrı bir mekanizma
 * değil, aynı transaction'da olmalarının doğal sonucu.
 */
@Injectable()
export class ReminderSchedulerService {
  constructor(private readonly queue: QueueService) {}

  /** Randevu oluşturulduğunda ya da ertelendiğinde çağrılır. */
  async scheduleForAppointment(
    tx: Tx,
    input: { tenantId: string; appointmentId: string; branchId: string; startsAt: Date; status: string },
  ): Promise<number> {
    if (!REMINDABLE.has(input.status)) return 0;

    const hours = await repo.resolveReminderHours(tx, input.branchId);
    let planned = 0;

    for (const offset of hours) {
      const scheduledFor = new Date(input.startsAt.getTime() - offset * 60 * 60 * 1000);
      // GEÇMİŞE hatırlatma planlanmaz: 24 saat sonrasına açılan bir randevunun
      // "48 saat önce" hatırlatması hemen gönderilirdi.
      if (scheduledFor.getTime() <= Date.now()) continue;

      const row = await repo.insertScheduled(tx, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        appointmentId: input.appointmentId,
        event: 'appointment_reminder',
        offsetHours: offset,
        scheduledFor,
      });
      if (row === undefined) continue;

      await this.queue.send(
        tx,
        QUEUES.REMINDER_SEND,
        { tenantId: input.tenantId, scheduledNotificationId: row.id },
        {
          startAfter: scheduledFor,
          // Aynı plan satırı için ikinci iş yazılmaz.
          singletonKey: `reminder:${row.id}`,
        },
      );
      planned += 1;
    }

    return planned;
  }

  /** Erteleme: eski plan `superseded`, yeni saate göre yeniden planlanır. */
  async reschedule(
    tx: Tx,
    input: { tenantId: string; appointmentId: string; branchId: string; startsAt: Date; status: string },
  ): Promise<void> {
    await repo.closePending(tx, input.appointmentId, 'superseded');
    await this.scheduleForAppointment(tx, input);
  }

  /**
   * İptal/no-show: bekleyen hatırlatmalar kapanır.
   *
   * Kuyruktaki iş İPTAL EDİLMEZ — pg-boss işi zamanı gelince yine koşar ama
   * satırı `pending` bulamayıp sessizce çıkar. Durum kontrolünü gönderim
   * anında yapmak, kuyruğu geriye dönük düzeltmeye çalışmaktan çok daha
   * güvenilir: iş zaten alınmış olabilir.
   */
  async cancelForAppointment(tx: Tx, appointmentId: string): Promise<number> {
    return repo.closePending(tx, appointmentId, 'cancelled');
  }

  /** No-show takibi: randevudan SONRA gider, bu yüzden offset negatiftir. */
  async scheduleNoShowFollowup(
    tx: Tx,
    input: { tenantId: string; appointmentId: string; branchId: string; startsAt: Date },
  ): Promise<boolean> {
    const settings = await repo.findBranchSettings(tx, input.branchId);
    if (settings !== undefined && !settings.noShowFollowupEnabled) return false;

    const delay = settings?.noShowFollowupDelayHours ?? 2;
    const scheduledFor = new Date(Date.now() + delay * 60 * 60 * 1000);

    const row = await repo.insertScheduled(tx, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      appointmentId: input.appointmentId,
      event: 'no_show_followup',
      offsetHours: -delay,
      scheduledFor,
    });
    if (row === undefined) return false;

    await this.queue.send(
      tx,
      QUEUES.REMINDER_SEND,
      { tenantId: input.tenantId, scheduledNotificationId: row.id },
      { startAfter: scheduledFor, singletonKey: `reminder:${row.id}` },
    );
    return true;
  }
}
