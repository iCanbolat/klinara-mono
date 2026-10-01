import type { MessageActionKind, NotificationEvent } from '../../database/schema';
import type { WhatsAppTemplateDraft } from '../../lib/whatsapp/whatsapp.types';

/**
 * Klinara'nın standart WhatsApp template seti.
 *
 * Template'ler WABA'ya aittir ve WABA'lar arasında PAYLAŞILAMAZ: her kliniğin
 * hesabında ayrı bir kopya gerekir. Kopyaları klinik elle açmasın diye set
 * burada tek yerde tanımlı ve `POST /integrations/whatsapp/templates/provision`
 * onu kiracının WABA'sına API ile yazıyor.
 *
 * Gövde metni DEĞİŞKEN ADLARIYLA yazılıyor (`{{customerName}}`) ve Meta'ya
 * giderken konumsal biçime (`{{1}}`) çevriliyor. Sıra `variables`tan gelir; iki
 * yerde ayrı ayrı tutulsaydı biri güncellenip öteki unutulduğunda müşteriye
 * yanlış isim giderdi.
 *
 * Meta'nın reddettiği kalıplardan kaçınılıyor: gövde değişkenle BAŞLAMAZ ya da
 * BİTMEZ, iki değişken yan yana durmaz.
 *
 * Adres ve konum bağlantısı randevu oluşturma ve hatırlatma template'lerinde
 * yer alır (`_v2`). Metin değişince ad da değişir: aynı adla yeniden gönderim
 * Meta'da "zaten var" olarak atlanır ve eski (adresiz, farklı konumlu)
 * template'e yeni konumsal sıra gönderilirdi — yanlış alana yanlış değer.
 *
 * Adres ve konum: adres gövdede, harita ise "Haritada aç" URL butonunda.
 * Konum bağlantısı gövdede değişken olarak durmuyordu çünkü Meta uzun bir URL
 * değişkenli, çok değişkenli gövdeyi `INVALID_FORMAT` ile reddetti (`_v2`).
 *
 * Örnek değerler (`examples`) Meta incelemesinde gövdenin parçası gibi
 * değerlendirilir: içlerinde `#`, `$`, `%` gibi özel karakter ya da sorgu
 * dizgeli (`?a=1&b=2`, `%C4%9F`) uzun bağlantı bulunursa şablon
 * `INVALID_FORMAT` ile reddedilir. Gerçek gönderimde değer serbest; kural
 * yalnız örnek için. `template-segments.test.ts` bunu sabitliyor.
 *
 * ⚠️ Ad değişikliği YENİ bir template demektir: Meta'da onaylı eski ad kalır,
 * yenisi onaya düşer. Adı değiştirmek yerine metni değiştirmek de aynı onayı
 * gerektirir — bu dosyaya dokunmak her kiracıda yeniden onay demek.
 */
export interface StandardTemplate {
  /** Bu template'i kullanan bildirim olayı; OTP bir olay değil. */
  event: NotificationEvent | null;
  name: string;
  language: string;
  category: WhatsAppTemplateDraft['category'];
  /** Değişken ADLARIYLA gövde; AUTHENTICATION'da yok (metni Meta üretir). */
  body?: string;
  /** Gövdedeki değişkenler, Meta'daki konum sırasıyla. */
  variables: string[];
  examples: Record<string, string>;
  /** Hızlı yanıt butonları ve her birinin randevuya karşılığı. */
  quickReplies?: { text: string; action: MessageActionKind }[];
  /**
   * Haritada aç butonu. Meta'da alan adı SABİT, yalnız sonuna `{{1}}` eklenir;
   * bu yüzden bağlantı şubenin adresinden üretilir: `variable` mesaj
   * değişkenlerindeki (kodlanmış adres) değerin adıdır. Gövdede geçmez.
   */
  urlButton?: { text: string; url: string; example: string; variable: string };
}

const MAPS_BUTTON = {
  text: 'Haritada aç',
  url: 'https://www.google.com/maps/search/?api=1&query={{1}}',
  example: 'https://www.google.com/maps/search/?api=1&query=Kadikoy',
  variable: 'branchMapsQuery',
} as const;

export const OTP_TEMPLATE_NAME = 'booking_otp';

export const STANDARD_TEMPLATES: readonly StandardTemplate[] = [
  {
    event: 'appointment_confirmation',
    name: 'klinara_randevu_olusturuldu_v3',
    language: 'tr',
    category: 'UTILITY',
    body:
      'Merhaba {{customerName}}, {{appointmentAt}} tarihindeki {{serviceName}} randevunuz başarıyla oluşturuldu. ' +
      'Sizi {{branchName}} şubemizde bekliyoruz.\n\n' +
      'Şubemize kolayca ulaşabilmeniz için adres bilgimizi paylaşıyor, konumu aşağıdaki butonla açabilmenizi sağlıyoruz.\n\n' +
      'Adres: {{branchAddress}}\n\n' +
      'Randevunuzla ilgili bir değişiklik olursa bu mesajı yanıtlayarak bize ulaşabilirsiniz. Görüşmek üzere!',
    variables: ['customerName', 'appointmentAt', 'serviceName', 'branchName', 'branchAddress'],
    examples: {
      customerName: 'Ayşe',
      appointmentAt: '24.09.2026 14:00',
      serviceName: 'Cilt bakımı',
      branchName: 'Kadıköy',
      branchAddress: 'Bağdat Caddesi 1, Kadıköy',
    },
    urlButton: MAPS_BUTTON,
  },
  {
    event: 'appointment_reminder',
    name: 'klinara_randevu_hatirlatma_v3',
    language: 'tr',
    category: 'UTILITY',
    body:
      'Merhaba {{customerName}}, {{appointmentAt}} tarihindeki {{serviceName}} randevunuzu hatırlatırız. ' +
      'Sizi {{branchName}} şubemizde bekliyoruz.\n\n' +
      'Şubemize kolayca ulaşabilmeniz için adres bilgimizi paylaşıyor, konumu aşağıdaki butonla açabilmenizi sağlıyoruz.\n\n' +
      'Adres: {{branchAddress}}\n\n' +
      'Katılımınızı aşağıdaki butonlarla bildirebilirsiniz.',
    variables: ['customerName', 'appointmentAt', 'serviceName', 'branchName', 'branchAddress'],
    examples: {
      customerName: 'Ayşe',
      appointmentAt: '24.09.2026 14:00',
      serviceName: 'Cilt bakımı',
      branchName: 'Kadıköy',
      branchAddress: 'Bağdat Caddesi 1, Kadıköy',
    },
    quickReplies: [
      { text: 'Onaylıyorum', action: 'confirm' },
      { text: 'İptal etmek istiyorum', action: 'cancel' },
    ],
    urlButton: MAPS_BUTTON,
  },
  {
    event: 'appointment_cancelled',
    name: 'klinara_randevu_iptal',
    language: 'tr',
    category: 'UTILITY',
    body:
      'Merhaba {{customerName}}, {{appointmentAt}} tarihindeki randevunuz iptal edilmiştir. ' +
      'Yeni bir randevu için {{branchName}} şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.',
    variables: ['customerName', 'appointmentAt', 'branchName'],
    examples: { customerName: 'Ayşe', appointmentAt: '24.09.2026 14:00', branchName: 'Kadıköy' },
  },
  {
    event: 'no_show_followup',
    name: 'klinara_gelmedi_takip',
    language: 'tr',
    category: 'UTILITY',
    body:
      'Merhaba {{customerName}}, bugünkü randevunuza gelemediğinizi gördük. ' +
      'Yeni bir randevu için {{branchName}} şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.',
    variables: ['customerName', 'branchName'],
    examples: { customerName: 'Ayşe', branchName: 'Kadıköy' },
  },
  {
    event: 'package_balance',
    name: 'klinara_paket_bakiye',
    language: 'tr',
    category: 'UTILITY',
    body:
      'Merhaba {{customerName}}, {{packageName}} paketinizde {{remainingSessions}} seans hakkınız kaldı. ' +
      'Randevu için bu mesajı yanıtlayabilirsiniz.',
    variables: ['customerName', 'packageName', 'remainingSessions'],
    examples: { customerName: 'Ayşe', packageName: 'Lazer 10 seans', remainingSessions: '3' },
  },
  {
    event: null,
    name: OTP_TEMPLATE_NAME,
    language: 'tr',
    category: 'AUTHENTICATION',
    variables: ['code'],
    examples: { code: '123456' },
  },
];

export const STANDARD_TEMPLATE_BY_EVENT: ReadonlyMap<NotificationEvent, StandardTemplate> = new Map(
  STANDARD_TEMPLATES.flatMap((template) =>
    template.event === null ? [] : [[template.event, template] as const],
  ),
);

export const STANDARD_TEMPLATE_BY_NAME: ReadonlyMap<string, StandardTemplate> = new Map(
  STANDARD_TEMPLATES.map((template) => [template.name, template] as const),
);

/** `{{customerName}}` → `{{1}}` — sıra `variables`tan. */
export function positionalBody(template: StandardTemplate): string {
  let body = template.body ?? '';
  template.variables.forEach((name, index) => {
    body = body.split(`{{${name}}}`).join(`{{${index + 1}}}`);
  });
  return body;
}

export function toDraft(template: StandardTemplate): WhatsAppTemplateDraft {
  if (template.category === 'AUTHENTICATION') {
    return {
      name: template.name,
      language: template.language,
      category: template.category,
      codeExpirationMinutes: 10,
    };
  }
  return {
    name: template.name,
    language: template.language,
    category: template.category,
    body: positionalBody(template),
    bodyExamples: template.variables.map((name) => template.examples[name] ?? name),
    ...(template.quickReplies === undefined
      ? {}
      : { quickReplies: template.quickReplies.map((reply) => reply.text) }),
    ...(template.urlButton === undefined
      ? {}
      : {
          urlButton: {
            text: template.urlButton.text,
            url: template.urlButton.url,
            example: template.urlButton.example,
          },
        }),
  };
}
