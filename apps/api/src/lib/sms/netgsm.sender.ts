import { PinoLogger } from 'nestjs-pino';
import { maskPhone } from '../../observability/redaction';
import type { SmsMessage, SmsResult, SmsSender } from './sms.types';

/**
 * Netgsm HTTP API uygulaması.
 *
 * Türkiye'de yerleşik bir sağlayıcı seçilmesi KVKK açısından bilinçlidir:
 * doğrulama kodları ve müşteri numaraları yurt dışına çıkmaz.
 *
 * Yanıt gövdesi `"<kod> <jobid>"` biçiminde düz metindir; `00` başarıdır.
 * HTTP 200 dönmesi gönderimin başarılı olduğu anlamına GELMEZ — sağlayıcı
 * hataları da 200 ile döner, bu yüzden gövde ayrıştırılır.
 */
const ERROR_MESSAGES: Record<string, string> = {
  '20': 'Mesaj metni hatalı veya karakter sınırı aşıldı',
  '30': 'Netgsm kimlik bilgileri geçersiz veya API erişimi kapalı',
  '40': 'Gönderici başlığı (msgheader) onaylı değil',
  '50': 'İYS kaynaklı hata: alıcı ticari ileti almayı reddetmiş',
  '51': 'İYS marka bilgisi eksik veya hatalı',
  '70': 'Gönderim parametreleri hatalı',
  '80': 'Gönderim sınırı aşıldı',
  '85': 'Mükerrer gönderim sınırı aşıldı',
};

export class NetgsmSmsSender implements SmsSender {
  constructor(
    private readonly config: {
      baseUrl: string;
      userCode: string;
      password: string;
      msgHeader: string;
    },
    private readonly logger: PinoLogger,
  ) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    const url = new URL('/sms/send/get', this.config.baseUrl);
    url.searchParams.set('usercode', this.config.userCode);
    url.searchParams.set('password', this.config.password);
    url.searchParams.set('msgheader', this.config.msgHeader);
    // Netgsm numarayı '+' olmadan bekler.
    url.searchParams.set('gsmno', message.to.replace(/^\+/, ''));
    url.searchParams.set('message', message.body);
    url.searchParams.set('dil', 'TR');

    // Sağlayıcı yavaşladığında istek zinciri asılı kalmasın: kullanıcı 10
    // saniyeden fazla "kod gönderiliyor" ekranında bekletilmez.
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });

    if (!response.ok) {
      throw new Error(`Netgsm HTTP ${response.status}`);
    }

    const body = (await response.text()).trim();
    const [code, jobId] = body.split(/\s+/);

    if (code !== '00' && code !== '01' && code !== '02') {
      const reason = ERROR_MESSAGES[code ?? ''] ?? `Bilinmeyen Netgsm yanıtı: ${body}`;
      throw new Error(`Netgsm gönderimi reddetti (${code ?? '?'}): ${reason}`);
    }

    // Numara MASKELİ loglanır; kimlik bilgileri hiç loglanmaz.
    this.logger.info({ provider: 'netgsm', to: maskPhone(message.to), jobId }, 'SMS gönderildi');

    return { provider: 'netgsm', providerMessageId: jobId ?? null };
  }
}
