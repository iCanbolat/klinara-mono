import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import type { Principal } from '../identity/principal';
import { formatAppointmentTime } from './appointment-notifier.service';
import * as reminderRepo from './reminders.repository';
import * as repo from './staff-notifications.repository';
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
  ) {}

  async emit(tx: Tx, input: repo.InsertStaffNotification): Promise<void> {
    try {
      await repo.insert(tx, input);
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
      const rows = await repo.list(tx, {
        userId: principal.userId,
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
        unreadCount: await repo.unreadCount(tx, principal.userId),
      };
    });
  }

  async markRead(principal: Principal, input: MarkStaffNotificationsReadDto): Promise<void> {
    await this.tx.run((tx) =>
      repo.markRead(tx, {
        tenantId: this.tx.tenantId,
        userId: principal.userId,
        ...(input.ids === undefined ? {} : { ids: input.ids }),
      }),
    );
  }
}
