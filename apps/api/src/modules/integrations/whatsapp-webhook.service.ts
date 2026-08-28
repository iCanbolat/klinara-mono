import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { normalizePhone } from '../../common/phone';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { NotificationDispatcherService } from '../notifications/notification-dispatcher.service';
import * as appointmentsRepo from '../booking/appointments.repository';
import * as repo from './webhook.repository';
import { verifyHubSignature } from './webhook-signature';

interface StatusUpdate {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { title?: string }[];
}

interface InboundMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string };
  button?: { payload?: string; text?: string };
  interactive?: { button_reply?: { id?: string; title?: string } };
}

/** Meta webhook gövdesinin ilgilendiğimiz parçaları. */
interface WebhookPayload {
  entry?: {
    id?: string;
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        statuses?: StatusUpdate[];
        messages?: InboundMessage[];
      };
    }[];
  }[];
}

const DELIVERY_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);
/** Ticari iletiyi durduran anahtar kelimeler. */
const STOP_WORDS = new Set(['stop', 'dur', 'iptal', 'çık', 'cik']);

export const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class WhatsAppWebhookService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly encryption: FieldEncryptionService,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** `hub.challenge` akışı — Meta webhook'u kaydederken bir kez çağırır. */
  verifyChallenge(query: {
    mode?: string | undefined;
    token?: string | undefined;
    challenge?: string | undefined;
  }): string {
    const expected = this.config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN', { infer: true });
    if (
      expected === undefined ||
      expected === '' ||
      query.mode !== 'subscribe' ||
      query.token !== expected
    ) {
      throw AppError.unauthenticated('Webhook doğrulama başarısız');
    }
    return query.challenge ?? '';
  }

  /**
   * Gelen olayı işler.
   *
   * Sıra ÖNEMLİ: önce imza, sonra kayıt, sonra iş. İmza doğrulanmadan hiçbir
   * şey yazılmaz — aksi hâlde herkes kiracının randevusunu iptal ettirebilirdi.
   */
  async handle(rawBody: Buffer, signature: string | undefined): Promise<{ duplicate: boolean }> {
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as WebhookPayload;
    } catch {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Webhook gövdesi çözümlenemedi');
    }

    const wabaId = payload.entry?.[0]?.id;
    if (wabaId === undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Webhook gövdesinde WABA kimliği yok');
    }

    // Kiracı çözümü İMZADAN ÖNCE gerekiyor: app secret kiracı satırında duruyor.
    // Bu bir sızıntı değil — `waba_id` zaten Meta tarafından bize gönderilen
    // herkese açık bir kimlik ve eşleşme olmadan hiçbir şey işlenmiyor.
    const account = await this.tx.runAsSystem((tx) => repo.findTenantByWaba(tx, wabaId));
    if (account?.appSecretEncrypted == null) {
      throw AppError.unauthenticated('Webhook imzası doğrulanamadı');
    }

    const appSecret = this.encryption.decrypt(account.appSecretEncrypted);
    if (!verifyHubSignature(rawBody, signature, appSecret)) {
      throw AppError.unauthenticated('Webhook imzası geçersiz');
    }

    // Meta tekil bir olay kimliği göndermiyor; AYNI gövde aynı olaydır.
    // Gövdenin sha256'sı bu yüzden idempotency anahtarı: yeniden gönderim
    // birebir aynı baytları taşır.
    const eventId = sha256(rawBody);

    return this.tx.runForTenant(account.tenantId, async (tx) => {
      const fresh = await repo.recordEvent(tx, {
        eventId,
        tenantId: account.tenantId,
        payload: payload as unknown as Record<string, unknown>,
      });
      if (!fresh) {
        // Tekrar eden olay: Meta 200 almadığını sandığında aynı olayı yeniden
        // gönderir. İkinci kez İŞLENMEZ.
        return { duplicate: true };
      }

      await this.process(tx, account.tenantId, payload);
      await repo.markProcessed(tx, eventId);
      return { duplicate: false };
    });
  }

  private async process(tx: Tx, tenantId: string, payload: WebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const status of change.value?.statuses ?? []) {
          await this.applyStatus(tx, status);
        }
        for (const message of change.value?.messages ?? []) {
          await this.applyMessage(tx, tenantId, message);
        }
      }
    }
  }

  private async applyStatus(tx: Tx, status: StatusUpdate): Promise<void> {
    const providerMessageId = status.id;
    const value = status.status;
    if (providerMessageId === undefined || value === undefined || !DELIVERY_STATUSES.has(value)) {
      return;
    }

    const at = WhatsAppWebhookService.timestampOf(status.timestamp);
    const errorDetail = status.errors?.[0]?.title;
    await repo.applyDeliveryStatus(tx, {
      providerMessageId,
      status: value as 'sent' | 'delivered' | 'read' | 'failed',
      at,
      ...(errorDetail !== undefined ? { errorDetail } : {}),
    });
  }

  private async applyMessage(tx: Tx, tenantId: string, message: InboundMessage): Promise<void> {
    const from = message.from === undefined ? null : normalizePhone(message.from);
    if (from === null || message.id === undefined) return;

    const at = WhatsAppWebhookService.timestampOf(message.timestamp);
    // Müşteri yazdı: 24 saatlik pencere AÇILDI (8.2 bunu okuyor).
    await repo.touchContactWindow(tx, tenantId, from, at);

    const customerId = await repo.findCustomerIdByPhone(tx, from);
    const token = message.button?.payload ?? message.interactive?.button_reply?.id;

    if (token !== undefined && token.length > 0) {
      await this.handleAction(tx, tenantId, { token, from, customerId });
      return;
    }

    const body = message.text?.body ?? null;
    await repo.insertInbound(tx, {
      tenantId,
      customerId,
      fromPhone: from,
      waMessageId: message.id,
      messageType: message.type ?? 'text',
      body,
      mediaId: message.image?.id ?? null,
      receivedAt: at,
    });

    // "STOP" bir gelen kutusu mesajı DEĞİL, bir taleptir: ticari ileti
    // gönderimini durdurur ve kaydı bırakır.
    if (customerId !== null && body !== null && STOP_WORDS.has(body.trim().toLowerCase())) {
      await repo.insertInboundOptOut(tx, tenantId, customerId);
    }
  }

  /**
   * Buton yanıtı: randevu onayı ya da iptali.
   *
   * `AppointmentsService` BİLEREK kullanılmıyor: o katman bir `Principal`
   * bekliyor ve webhook'un bir kullanıcısı yok. Sahte bir principal üretmek,
   * olmayan bir yetkiyi varmış gibi göstermek olurdu. Bunun yerine aynı
   * repository fonksiyonları ve aynı geçiş tablosu kullanılıyor; DB trigger'ı
   * (K0001) yine son savunma hattı.
   */
  private async handleAction(
    tx: Tx,
    tenantId: string,
    input: { token: string; from: string; customerId: string | null },
  ): Promise<void> {
    const action = await repo.consumeAction(tx, sha256(input.token));

    if (action === undefined) {
      const known = await repo.findActionByToken(tx, sha256(input.token));
      await this.reply(
        tx,
        tenantId,
        input,
        known === undefined
          ? 'Bu bağlantıyı tanıyamadık. Lütfen kliniğimizle iletişime geçin.'
          : 'Bu bağlantının süresi dolmuş ya da daha önce kullanılmış. Lütfen kliniğimizle iletişime geçin.',
      );
      return;
    }

    const appointment = await appointmentsRepo.findAppointmentById(tx, action.appointmentId);
    if (appointment === undefined) return;

    if (action.action === 'cancel') {
      const withinWindow = await WhatsAppWebhookService.cancelWindowOpen(tx, appointment.startsAt);
      if (!withinWindow) {
        await this.reply(
          tx,
          tenantId,
          input,
          'Randevunuz iptal edilemedi: iptal süresi dolmuş. Lütfen kliniğimizle iletişime geçin.',
        );
        return;
      }
    }

    const target = action.action === 'confirm' ? 'confirmed' : 'cancelled';
    const transition = await appointmentsRepo.findAllowedTransition(tx, appointment.status, target);
    if (transition === undefined) {
      await this.reply(
        tx,
        tenantId,
        input,
        'Randevunuzun durumu değiştirilemedi. Lütfen kliniğimizle iletişime geçin.',
      );
      return;
    }

    const updated = await appointmentsRepo.updateWithVersion(tx, appointment.id, appointment.version, {
      status: target,
      ...(target === 'cancelled'
        ? { cancellationReason: 'WhatsApp buton yanıtı', cancelledAt: new Date() }
        : {}),
    });
    if (updated === undefined) return;

    await appointmentsRepo.insertHistory(tx, {
      tenantId,
      appointmentId: appointment.id,
      // Aktör YOK ve olmamalı: bunu bir personel değil, müşteri yaptı.
      actorUserId: null,
      action: target === 'cancelled' ? 'cancelled' : 'status_changed',
      fromStatus: appointment.status,
      toStatus: target,
      reason: 'WhatsApp buton yanıtı',
    });

    await this.reply(
      tx,
      tenantId,
      input,
      target === 'confirmed'
        ? 'Randevunuz onaylandı. Görüşmek üzere!'
        : 'Randevunuz iptal edildi. Yeni randevu için bize yazabilirsiniz.',
    );
  }

  /** Otomatik cevap bildirim çekirdeğinden geçer: gönderilen her mesaj kayıtlıdır. */
  private async reply(
    tx: Tx,
    tenantId: string,
    input: { customerId: string | null },
    message: string,
  ): Promise<void> {
    if (input.customerId === null) return;
    await this.dispatcher.enqueue(tx, tenantId, {
      event: 'auto_reply',
      customerId: input.customerId,
      channels: ['whatsapp'],
      variables: { message },
    });
  }

  /** İptal penceresi kiracı ayarından gelir (`cancel_window_hours`). */
  private static async cancelWindowOpen(tx: Tx, startsAt: Date): Promise<boolean> {
    const hours = await repo.cancelWindowHours(tx);
    return startsAt.getTime() - Date.now() > hours * 60 * 60 * 1000;
  }

  /** Meta zaman damgası saniye cinsindendir. */
  private static timestampOf(raw: string | undefined): Date {
    const seconds = Number(raw ?? '');
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
  }
}
