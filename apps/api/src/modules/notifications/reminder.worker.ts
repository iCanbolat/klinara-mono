import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { toZonedIso } from '../../common/time';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import * as repo from './reminders.repository';

export interface ReminderJob {
  tenantId: string;
  scheduledNotificationId: string;
}

/** Hangi randevu durumu hangi bildirimi hâlâ hak ediyor. */
const REQUIRED_STATUS: Record<string, Set<string>> = {
  appointment_reminder: new Set(['scheduled', 'confirmed']),
  no_show_followup: new Set(['no_show']),
};

/**
 * Hatırlatma gönderimi.
 *
 * Randevunun durumu GÖNDERİM ANINDA yeniden okunur: iptal edilmiş bir randevu
 * için hatırlatma gitmez. Bu kontrolün burada olması kasıtlı — kuyruktaki işi
 * geriye dönük iptal etmeye çalışmak (iş çoktan alınmış olabilir) çok daha
 * kırılgan olurdu.
 */
@Injectable()
export class ReminderWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.REMINDER_SEND, async (jobs) => {
      for (const job of jobs) await this.handle(job.data as ReminderJob);
    });
  }

  async handle(job: ReminderJob): Promise<void> {
    await this.tx.runForTenant(job.tenantId, async (tx) => {
      const scheduled = await repo.findScheduledById(tx, job.scheduledNotificationId);
      // Satır yok (rollback) ya da artık beklemiyor (iptal, erteleme, gönderim).
      if (scheduled === undefined || scheduled.status !== 'pending') return;

      const appointment = await repo.findAppointmentSummary(tx, scheduled.appointmentId);
      if (appointment === undefined) {
        await repo.markScheduled(tx, scheduled.id, 'cancelled');
        return;
      }

      const allowed = REQUIRED_STATUS[scheduled.event] ?? new Set<string>();
      if (!allowed.has(appointment.status)) {
        await repo.markScheduled(tx, scheduled.id, 'cancelled');
        this.logger.debug(
          { appointmentId: appointment.id, status: appointment.status },
          'Hatırlatma gönderilmedi: randevu durumu uygun değil',
        );
        return;
      }

      const result = await this.dispatcher.enqueue(tx, job.tenantId, {
        event: scheduled.event,
        customerId: appointment.customerId,
        branchId: appointment.branchId,
        // Çift gönderim koruması: plan satırının kimliği aynı zamanda mesajın
        // tekillik anahtarı. İki worker aynı işi alsa bile ikinci mesaj
        // yazılamaz (`message_log` kısmi tekil indeksi).
        dedupeKey: `scheduled:${scheduled.id}`,
        variables: {
          customerName: appointment.customerName,
          branchName: appointment.branchName,
          appointmentAt: ReminderWorker.formatAppointmentTime(appointment),
          serviceName: appointment.serviceNames.join(', '),
        },
      });

      await repo.markScheduled(
        tx,
        scheduled.id,
        'sent',
        result.status === 'queued' ? result.messageId : null,
      );
    });
  }

  /** Saat ŞUBENİN saat diliminde yazılır — müşteri klinikteki saati okur. */
  private static formatAppointmentTime(appointment: repo.AppointmentSummary): string {
    const iso = toZonedIso(appointment.startsAt, appointment.branchTimezone);
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
  }
}
