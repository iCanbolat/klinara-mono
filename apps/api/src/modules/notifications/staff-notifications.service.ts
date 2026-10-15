import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { RealtimeBusService } from '../../lib/realtime/realtime-bus.service';
import type { Tx } from '../../database/tenant-tx';
import { PERMISSIONS } from '@klinara/shared';
import { hasPermission, type Principal } from '../identity/principal';
import { formatAppointmentTime } from './appointment-notifier.service';
import * as reminderRepo from './reminders.repository';
import * as repo from './staff-notifications.repository';
import type { StaffPushJob } from './staff-push.worker';
import type {
  MarkStaffNotificationsReadDto,
  StaffNotificationFeedDto,
} from './dto/staff-notification.dto';

const DEFAULT_LIMIT = 20;

const TITLES = {
  appointment_created: 'Online randevu oluşturuldu',
  appointment_cancelled: 'Randevu iptal edildi',
  appointment_rescheduled: 'Randevu saati değiştirildi',
} as const;

/**
 * Panelin zil ikonuna düşen personel bildirimleri.
 *
 * Müşteriye giden iletilerden (`NotificationDispatcherService`) AYRI: burada
 * kanal, şablon, sessiz saat ve opt-out yok — bildirim panelin içinde kalıyor
 * ve kimseye mesaj göndermiyor.
 *
 * `emit` ÇAĞIRANIN transaction'ına yazar: randevu rollback olursa "randevu
 * oluşturuldu" bildirimi de yazılmaz.
 */
@Injectable()
export class StaffNotificationsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly logger: PinoLogger,
    private readonly realtime: RealtimeBusService,
    private readonly queue: QueueService,
  ) {}

  async emit(tx: Tx, input: repo.InsertStaffNotification): Promise<void> {
    try {
      const { id } = await repo.insert(tx, input);
      // Açık paneller anında haberdar olur. Aynı transaction: commit olmazsa
      // yayın da olmaz.
      await this.realtime.publish(tx, {
        tenantId: input.tenantId,
        branchId: input.branchId ?? null,
        type: 'staff_notification',
        kind: input.kind,
      });
      // Uygulaması kapalı olan personelin telefonuna push (yine aynı
      // transaction: rollback olan randevunun push'u da yazılmaz).
      const job: StaffPushJob = { tenantId: input.tenantId, notificationId: id };
      await this.queue.send(tx, QUEUES.STAFF_PUSH_SEND, job);
    } catch (error: unknown) {
      // Bildirim yan üründür: yazılamaması randevuyu ya da gelen mesajı
      // düşürmemeli.
      this.logger.warn({ err: error, kind: input.kind }, 'Personel bildirimi yazılamadı');
    }
  }

  /**
   * Randevu olayları — müşterinin KENDİ başlattığı işlemler.
   *
   * Personelin panelden yaptığı randevu işlemleri bildirilmiyor: kendi
   * yaptığı işi kendine haber vermek zil ikonunu gürültüye boğardı.
   */
  async emitAppointmentEvent(
    tx: Tx,
    tenantId: string,
    appointmentId: string,
    kind: 'appointment_created' | 'appointment_cancelled' | 'appointment_rescheduled',
  ): Promise<void> {
    const appointment = await reminderRepo.findAppointmentSummary(tx, appointmentId);
    if (appointment === undefined) return;

    await this.emit(tx, {
      tenantId,
      branchId: appointment.branchId,
      kind,
      title: TITLES[kind],
      body: `${appointment.customerName} · ${formatAppointmentTime(appointment)} · ${appointment.branchName}`,
      link: `/takvim?randevu=${appointmentId}`,
      appointmentId,
    });
  }

  async feed(
    principal: Principal,
    query: { limit?: number; before?: string },
  ): Promise<StaffNotificationFeedDto> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, 50);
    const before = query.before === undefined ? undefined : new Date(query.before);

    return this.tx.run(async (tx) => {
      const viewer = viewerOf(principal);
      const rows = await repo.list(tx, {
        viewer,
        limit,
        ...(before === undefined ? {} : { before }),
      });
      return {
        data: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          body: row.body,
          link: row.link,
          createdAt: row.createdAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
        })),
        unreadCount: await repo.unreadCount(tx, viewer),
      };
    });
  }

  async markRead(principal: Principal, input: MarkStaffNotificationsReadDto): Promise<void> {
    await this.tx.run((tx) =>
      repo.markRead(tx, {
        tenantId: this.tx.tenantId,
        viewer: viewerOf(principal),
        ...(input.ids === undefined ? {} : { ids: input.ids }),
      }),
    );
  }
}

function viewerOf(principal: Principal): repo.NotificationViewer {
  return {
    userId: principal.userId,
    tenantWide: principal.tenantWide,
    branchIds: principal.branchIds,
    canMessage: hasPermission(principal, PERMISSIONS.NOTIFICATION_SEND),
    readsAllAppointments: hasPermission(principal, PERMISSIONS.APPOINTMENT_READ_ALL),
  };
}
