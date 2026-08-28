import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES } from '@klinara/shared';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { MetricsService } from '../../observability/metrics.service';
import { ChannelRegistryService } from './channel-registry.service';
import * as repo from './notifications.repository';
import { PermanentSendError, TransientSendError } from './send-errors';

export interface NotificationJob {
  tenantId: string;
  messageId: string;
}

/**
 * Bildirim gönderim worker'ı.
 *
 * İş yalnız KİMLİKLERİ taşır; alıcının adresi ve metin işin kendi
 * transaction'ında, RLS altında okunur. Adres `message_log`'da maskeli
 * durduğu için burada müşteri/kullanıcı satırından YENİDEN çözülür — bunun
 * yan faydası, kuyrukta bekleyen bir mesajın güncellenmiş numaraya gitmesidir.
 */
@Injectable()
export class NotificationSenderWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    private readonly channels: ChannelRegistryService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.NOTIFICATION_SEND, async (jobs) => {
      for (const job of jobs) await this.handle(job.data as NotificationJob);
    });
  }

  async handle(job: NotificationJob): Promise<void> {
    const prepared = await this.tx.runForTenant(job.tenantId, async (tx) => {
      const message = await repo.findMessageById(tx, job.messageId);
      // Satır yoksa (rollback) ya da artık kuyrukta değilse (iptal edildi,
      // başka bir worker aldı) iş SESSİZCE biter. Durum kontrolü burada,
      // gönderimden önce yapılıyor: 8.4'te iptal edilmiş bir randevunun
      // hatırlatması tam olarak bu yolla susuyor.
      if (message === undefined || message.status !== 'queued') return undefined;

      const contact =
        message.customerId !== null
          ? await repo.findCustomerContact(tx, message.customerId)
          : message.userId !== null
            ? await repo.findUserContact(tx, message.userId)
            : undefined;

      const address =
        contact === undefined
          ? undefined
          : ChannelRegistryService.addressFor(message.channel, contact);

      // WhatsApp'ta metin BİZDEN gitmez: Meta'da onaylı template adı ve onun
      // KONUMSAL parametreleri gerekir. Eşlemeyi şablon satırı taşıyor
      // (`whatsapp_variables`), değerleri mesaj satırı (`template_variables`).
      const whatsapp =
        message.channel === 'whatsapp' && message.templateId !== null
          ? await repo.findTemplateById(tx, message.templateId)
          : undefined;

      await repo.updateMessage(tx, message.id, {
        status: 'sending',
        attempt: message.attempt + 1,
      });

      return { message, address, whatsapp };
    });

    if (prepared === undefined) return;
    const { message, address, whatsapp } = prepared;

    if (address === undefined) {
      await this.fail(job.tenantId, message, {
        code: ERROR_CODES.CHANNEL_NOT_CONFIGURED,
        detail: 'Alıcının bu kanalda adresi yok',
      });
      return;
    }

    try {
      const outcome = await this.channels.send({
        tenantId: job.tenantId,
        channel: message.channel,
        to: address,
        subject: message.renderedSubject ?? undefined,
        body: message.renderedBody ?? '',
        ...(whatsapp === undefined
          ? {}
          : {
              whatsapp: {
                templateName: whatsapp.whatsappTemplateName ?? undefined,
                templateLanguage: whatsapp.whatsappTemplateLanguage ?? undefined,
                parameters: whatsapp.whatsappVariables.map(
                  (name) => message.templateVariables?.[name] ?? '',
                ),
              },
            }),
      });

      await this.tx.runForTenant(job.tenantId, (tx) =>
        repo.updateMessage(tx, message.id, {
          status: 'sent',
          sentAt: new Date(),
          provider: outcome.provider,
          providerMessageId: outcome.providerMessageId,
          errorCode: null,
          errorDetail: null,
        }),
      );
      this.metrics.notificationsSent.inc({ channel: message.channel, status: 'sent' });
    } catch (error) {
      if (error instanceof PermanentSendError) {
        await this.fail(job.tenantId, message, { code: error.code, detail: error.message });
        return;
      }

      // GEÇİCİ hata: satır `queued`a döner ve iş kuyruğa fırlatılır. Durumu
      // geri almak şart — `sending`de bırakılsaydı yeniden deneme kendi
      // durum kontrolüne takılıp sessizce hiçbir şey yapmazdı.
      const detail = error instanceof Error ? error.message : String(error);
      // Kod hatanın KENDİSİNDEN gelir: "kota aşıldı" ile "bağlanamadım" aynı
      // şey değil ve mesaj kaydına doğru sebep yazılmalı.
      const code =
        error instanceof TransientSendError ? error.code : ERROR_CODES.SERVICE_UNAVAILABLE;
      await this.tx.runForTenant(job.tenantId, (tx) =>
        repo.updateMessage(tx, message.id, {
          status: 'queued',
          errorCode: code,
          errorDetail: detail,
        }),
      );
      this.logger.warn({ messageId: message.id, err: detail }, 'Bildirim gönderimi yeniden denenecek');
      throw error;
    }
  }

  private async fail(
    tenantId: string,
    message: repo.MessageLogRow,
    error: { code: string; detail: string },
  ): Promise<void> {
    await this.tx.runForTenant(tenantId, (tx) =>
      repo.updateMessage(tx, message.id, {
        status: 'failed',
        failedAt: new Date(),
        errorCode: error.code,
        errorDetail: error.detail,
      }),
    );
    this.metrics.notificationsSent.inc({ channel: message.channel, status: 'failed' });
    this.logger.warn({ messageId: message.id, code: error.code }, 'Bildirim gönderilemedi');
  }
}
