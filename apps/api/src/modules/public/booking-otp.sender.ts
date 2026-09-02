import { Inject, Injectable, Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SMS_SENDER, type SmsSender } from '../../lib/sms/sms.types';
import { WhatsAppSenderService } from '../integrations/whatsapp-sender.service';
import type { BookingOtpChannel } from '../../database/schema';

/** Meta'da onaylanması gereken kimlik doğrulama template'inin adı. */
export const OTP_TEMPLATE_NAME = 'booking_otp';

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
 * Kanal WhatsApp seçilmişse ve kiracının WABA hesabı yoksa ya da template
 * onaylı değilse SMS'e DÜŞÜLÜR. Aksi hâlde WhatsApp kurulumunu tamamlamamış
 * bir klinik online randevu alamazdı.
 */
@Injectable()
export class BookingOtpSender {
  constructor(
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly logger: PinoLogger,
    @Optional() private readonly whatsapp?: WhatsAppSenderService,
  ) {}

  async send(input: {
    tenantId: string;
    channel: BookingOtpChannel;
    phone: string;
    code: string;
    clinicName: string;
  }): Promise<void> {
    if (input.channel === 'whatsapp' && this.whatsapp !== undefined) {
      try {
        await this.whatsapp.send(input.tenantId, {
          to: input.phone,
          // `body` template gönderiminde kullanılmıyor ama arayüz zorunlu
          // tutuyor; gönderim başarısız olursa loga düşecek metin bu.
          body: `Randevu doğrulama kodunuz: ${input.code}`,
          templateName: OTP_TEMPLATE_NAME,
          templateLanguage: 'tr',
          parameters: [input.code],
        });
        return;
      } catch (error: unknown) {
        // Kod LOGLANMAZ; yalnız düşme sebebi kaydedilir.
        this.logger.warn(
          { err: error, tenantId: input.tenantId },
          'WhatsApp OTP gönderilemedi, SMS’e düşülüyor',
        );
      }
    }

    await this.sms.send({
      to: input.phone,
      body: `${input.clinicName} randevu doğrulama kodunuz: ${input.code}`,
    });
  }
}
