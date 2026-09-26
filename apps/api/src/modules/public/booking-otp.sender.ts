import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { SMS_SENDER, type SmsSender } from '../../lib/sms/sms.types';
import { WhatsAppSenderService } from '../integrations/whatsapp-sender.service';
import type { BookingOtpChannel } from '../../database/schema';
import { OTP_TEMPLATE_NAME } from '../integrations/whatsapp-standard-templates';

/** Meta'da onaylanması gereken kimlik doğrulama template'inin adı (standart setin parçası). */
export { OTP_TEMPLATE_NAME };

/**
 * Randevu sayfasının doğrulama kodunu gönderir.
 *
 * ⚠️ Bu gönderim BİLDİRİM ÇEKİRDEĞİNDEN (`NotificationDispatcherService`)
 * GEÇMEZ ve bu kasıtlıdır:
 *
 *   * Dispatcher bir `customerId` ya da `userId` ister; OTP anında müşteri
 *     kaydı HENÜZ YOK (kayıt ancak randevu oluşturulurken açılıyor).
 *   * Sessiz saat ertelemesi ve opt-out kontrolü burada YANLIŞ olurdu: bir
 *     doğrulama kodu ertelenirse randevu akışı kırılır. Kod, kullanıcının
 *     kendi başlattığı bir işlemin parçası — pazarlama mesajı değil.
 *
 * Kanal WhatsApp seçilmişse sıra: onaylı template → (yalnız GELİŞTİRMEDE,
 * pencere açıksa) serbest metin → SMS. Aksi hâlde WhatsApp kurulumunu
 * tamamlamamış bir klinik online randevu alamazdı.
 */
@Injectable()
export class BookingOtpSender {
  private readonly allowTextFallback: boolean;

  constructor(
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly logger: PinoLogger,
    config: ConfigService<EnvironmentVariables, true>,
    @Optional() private readonly whatsapp?: WhatsAppSenderService,
  ) {
    // Üretimde kod YALNIZ onaylı AUTHENTICATION template'iyle gider: serbest
    // metin kimlik doğrulama şablonunun kopyalama butonunu ve Meta'nın OTP
    // kurallarını kaybettirir.
    this.allowTextFallback = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  async send(input: {
    tenantId: string;
    channel: BookingOtpChannel;
    phone: string;
    code: string;
    clinicName: string;
  }): Promise<void> {
    const text = `${input.clinicName} randevu doğrulama kodunuz: ${input.code}`;

    const whatsapp = this.whatsapp;
    if (input.channel === 'whatsapp' && whatsapp !== undefined) {
      const sentAsTemplate = await this.tryWhatsApp(input.tenantId, 'template', () =>
        whatsapp.send(input.tenantId, {
          to: input.phone,
          body: text,
          templateName: OTP_TEMPLATE_NAME,
          templateLanguage: 'tr',
          parameters: [input.code],
          // Kimlik doğrulama template'i kodu kopyalama butonunda da ister;
          // yalnız gövdede gönderilirse Meta parametre uyuşmazlığıyla reddeder.
          copyCode: input.code,
        }),
      );
      if (sentAsTemplate) return;

      // Template yoksa (onaysız ya da AUTHENTICATION açılamayan bir WABA)
      // müşteri son 24 saatte yazmışsa kod serbest metinle gider. Pencere
      // kapalıysa sender Meta'ya gitmeden reddeder ve SMS'e düşülür.
      if (this.allowTextFallback) {
        const sentAsText = await this.tryWhatsApp(input.tenantId, 'text', () =>
          whatsapp.send(input.tenantId, { to: input.phone, body: text }),
        );
        if (sentAsText) return;
      }
    }

    await this.sms.send({ to: input.phone, body: text });
  }

  private async tryWhatsApp(
    tenantId: string,
    mode: 'template' | 'text',
    send: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await send();
      return true;
    } catch (error: unknown) {
      // Kod LOGLANMAZ; yalnız düşme sebebi kaydedilir.
      this.logger.warn({ err: error, tenantId, mode }, 'WhatsApp OTP gönderilemedi');
      return false;
    }
  }
}
