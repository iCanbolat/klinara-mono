import type { NotificationChannel, NotificationEvent } from '../../database/schema';

export interface TemplateDefinition {
  subject?: string;
  body: string;
}

export interface EventDefinition {
  /** Denenecek kanallar, öncelik sırasında. */
  channels: NotificationChannel[];
  /** Şablonun beklediği değişkenler — çağıranın sözleşmesi. */
  variables: string[];
  templates: Partial<Record<NotificationChannel, TemplateDefinition>>;
}

/**
 * Varsayılan şablonlar ve olay tanımları.
 *
 * Kiracıya satır BASILMAZ: basılsaydı metni iyileştiren her sürüm, kiracı
 * sayısı kadar satırı göç ettirmek zorunda kalırdı. Kiracı `PUT
 * /notification-templates` ile kendi metnini yazana kadar buradaki geçerlidir.
 *
 * WhatsApp metni buradan GİTMEZ: 24 saat penceresi dışında yalnız Meta'da
 * onaylı template gönderilebilir (mimari karar 4.6). Müşteri olaylarının
 * metni standart template setindedir (`whatsapp-standard-templates.ts`);
 * kiracı başka bir template eşlediyse şablon satırındaki
 * `whatsapp_template_name` kullanılır (8.2).
 *
 * Yalnız işlemsel iletiler var: ürün pazarlama iletisi göndermez. SMS kanalı
 * da müşteriye kapalı — klinik müşterisiyle yalnız WhatsApp yazışır.
 *
 * **E-posta müşteriye gitmez.** Klinik müşterisiyle yalnız WhatsApp üzerinden
 * yazışır; e-posta kanalı bu yüzden müşteri olaylarının hiçbirinde yok.
 * `staff_internal` bir istisna değil, farklı bir alıcı: personele giden iç
 * bildirim ve e-posta orada tek makul kanal.
 */
export const EVENT_DEFINITIONS: Record<NotificationEvent, EventDefinition> = {
  appointment_confirmation: {
    channels: ['whatsapp'],
    variables: [
      'customerName',
      'branchName',
      'branchAddress',
      'appointmentAt',
      'serviceName',
    ],
    templates: {},
  },
  appointment_reminder: {
    channels: ['whatsapp'],
    variables: [
      'customerName',
      'branchName',
      'branchAddress',
      'appointmentAt',
      'serviceName',
    ],
    templates: {},
  },
  appointment_cancelled: {
    channels: ['whatsapp'],
    variables: ['customerName', 'branchName', 'appointmentAt'],
    templates: {},
  },
  no_show_followup: {
    channels: ['whatsapp'],
    variables: ['customerName', 'branchName'],
    templates: {},
  },
  package_balance: {
    channels: ['whatsapp'],
    variables: ['customerName', 'packageName', 'remainingSessions'],
    templates: {},
  },
  package_expiring: {
    channels: ['whatsapp'],
    variables: ['customerName', 'packageName', 'expiresAt', 'remainingSessions'],
    templates: {},
  },
  // Gelen bir buton yanıtına ANINDA verilen cevap (8.3). Pencere açıktır
  // (müşteri az önce yazdı), bu yüzden serbest metin gider.
  auto_reply: {
    channels: ['whatsapp'],
    variables: ['message'],
    templates: {
      whatsapp: { body: '{{message}}' },
    },
  },
  // Resepsiyonun sohbet ekranından elle yazdığı cevap. Kuyruktan GEÇMEZ —
  // `ConversationsService` senkron gönderir; tanım yalnız kayıt ve tip
  // bütünlüğü için var ve ayar ekranlarında listelenmez (`CONFIGURABLE_EVENTS`).
  staff_reply: {
    channels: ['whatsapp'],
    variables: ['message'],
    templates: {
      whatsapp: { body: '{{message}}' },
    },
  },
  // Personele giden iç bildirim: sessiz saat UYGULANMAZ (bkz. dispatcher).
  // Alıcı müşteri değil, bu yüzden e-posta burada kalır.
  staff_internal: {
    channels: ['email'],
    variables: ['subject', 'message'],
    templates: {
      email: { subject: '{{subject}}', body: '{{message}}' },
    },
  },
};

export const ALL_EVENTS = Object.keys(EVENT_DEFINITIONS) as NotificationEvent[];

/**
 * Şablon ve tercih ekranlarında görünen olaylar.
 *
 * `staff_reply` dışarıda: metni resepsiyon her seferinde kendisi yazıyor,
 * kanal tercihi de yok (sohbet WhatsApp'ta). `staff_internal` de dışarıda:
 * alıcısı müşteri değil personel, metni kiracı değil platform belirliyor
 * (davet, parola sıfırlama gibi e-postalar `MailModule`den platformun kendi
 * adresiyle gidiyor). Olay tanımı kalıyor çünkü mesaj günlüğünde geçmiş
 * `staff_internal` satırları var.
 */
export const CONFIGURABLE_EVENTS: NotificationEvent[] = ALL_EVENTS.filter(
  (event) => event !== 'staff_reply' && event !== 'staff_internal',
);

/**
 * Kanal soyutlamasının tamamı — wire düzeyi küme.
 *
 * `email` burada duruyor çünkü `staff_internal` onu kullanıyor ve geçmiş
 * `message_log` satırları e-posta taşıyor; enum'dan çıkarmak eski günlüğü
 * çözülemez yapardı.
 */
export const ALL_CHANNELS: NotificationChannel[] = ['whatsapp', 'email', 'push'];

/**
 * Müşteriye gidebilecek kanallar.
 *
 * Tercih listelerinin ve müşteri olaylarına yazılan şablonların doğrulama
 * kümesi budur. `email` ve `push` dışarıda: birincisi ürün kararı (klinik
 * müşterisiyle yalnız WhatsApp yazışır), ikincisinin sağlayıcısı yok.
 */
export const CUSTOMER_CHANNELS: NotificationChannel[] = ['whatsapp'];

/** Alıcısı personel olan olaylar — `CUSTOMER_CHANNELS` kısıtı bunlara UYGULANMAZ. */
export const STAFF_EVENTS: NotificationEvent[] = ['staff_internal'];

export function isCustomerEvent(event: NotificationEvent): boolean {
  return !STAFF_EVENTS.includes(event);
}
