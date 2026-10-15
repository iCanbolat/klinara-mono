import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { StaffNotificationKind } from '../../database/schema';
import { PUSH_SENDER, type PushMessage, type PushSender } from '../../lib/push/push.types';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import * as pushRepo from './push-devices.repository';
import * as repo from './staff-notifications.repository';

export interface StaffPushJob {
  tenantId: string;
  notificationId: string;
}

/**
 * Kilit ekranında görünecek metin. Müşteri adı, hizmet, saat ya da mesaj
 * içeriği YAZILMAZ: bunlar sağlık verisi sayılır ve telefonun kilit ekranı
 * klinikte herkesin gözü önünde. Ayrıntı uygulamanın içinde, yetkiyle okunur.
 */
const COPY: Record<StaffNotificationKind, { title: string; body: string }> = {
  appointment_created: { title: 'Yeni online randevu', body: 'Ayrıntılar için dokunun.' },
  appointment_cancelled: { title: 'Randevu iptal edildi', body: 'Ayrıntılar için dokunun.' },
  appointment_rescheduled: { title: 'Randevu saati değişti', body: 'Ayrıntılar için dokunun.' },
  inbound_message: { title: 'Yeni WhatsApp mesajı', body: 'Okumak için dokunun.' },
  delivery_failed: { title: 'Mesaj iletilemedi', body: 'Ayrıntılar için dokunun.' },
};

/**
 * Personel bildiriminin push kopyası.
 *
 * Alıcılar İŞ ANINDA çözülür (`push_recipients`): bildirim yazıldıktan sonra
 * çıkış yapan ya da yetkisi alınan birine gitmez. Başarısız gönderim yeniden
 * DENENMEZ — push bir hatırlatıcı, asıl kayıt zil akışında duruyor ve
 * dakikalar sonra gelen "yeni randevu" bildirimi yarardan çok kafa karıştırır.
 */
@Injectable()
export class StaffPushWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.STAFF_PUSH_SEND, async (jobs) => {
      for (const job of jobs) await this.handle(job.data as StaffPushJob);
    });
  }

  async handle(job: StaffPushJob): Promise<void> {
    const target = await this.tx.runForTenant(job.tenantId, async (tx) => {
      const notification = await repo.findForPush(tx, job.notificationId);
      if (notification === undefined) return undefined;
      const devices = await pushRepo.recipients(tx, notification);
      return { notification, devices };
    });
    if (target === undefined || target.devices.length === 0) return;

    const { notification, devices } = target;
    const data: Record<string, string> = { kind: notification.kind };
    if (notification.appointmentId !== null) data.appointmentId = notification.appointmentId;
    if (notification.conversationId !== null) data.conversationId = notification.conversationId;

    const message: PushMessage = {
      ...COPY[notification.kind],
      data,
      // Aynı sohbetten art arda gelen mesajlar tek bildirimde birikir.
      ...(notification.conversationId === null
        ? {}
        : { collapseKey: `conversation:${notification.conversationId}` }),
    };

    // Ağ çağrıları transaction DIŞINDA: yavaş bir sağlayıcı bağlantı tutmasın.
    const dead: string[] = [];
    await Promise.all(
      devices.map(async (device) => {
        const outcome = await this.sender.send(device, message);
        if (outcome.status === 'invalid_token') dead.push(device.id);
        if (outcome.status === 'failed') {
          this.logger.warn(
            { platform: device.platform, reason: outcome.reason },
            'Push gönderilemedi',
          );
        }
      }),
    );

    if (dead.length > 0) {
      await this.tx.runForTenant(job.tenantId, (tx) => pushRepo.forget(tx, dead));
    }
  }
}
