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
}

export const OTP_TEMPLATE_NAME = 'booking_otp';

export const STANDARD_TEMPLATES: readonly StandardTemplate[] = [
  {
    event: 'appointment_confirmation',
    name: 'klinara_randevu_olusturuldu',
    language: 'tr',
    category: 'UTILITY',
    body:
      'Merhaba {{customerName}}, {{appointmentAt}} tarihindeki {{serviceName}} randevunuz oluşturuldu. ' +
      'Sizi {{branchName}} şubemizde bekliyoruz.',
    variables: ['customerName', 'appointmentAt', 'serviceName', 'branchName'],
    examples: {
      customerName: 'Ayşe',
      appointmentAt: '24.09.2026 14:00',
      serviceName: 'Cilt bakımı',
      branchName: 'Kadıköy',
    },
  },
  {
    event: 'appointment_reminder',
    name: 'klinara_randevu_hatirlatma',
    language: 'tr',
    category: 'UTILITY',
    body:
      'Merhaba {{customerName}}, {{appointmentAt}} tarihindeki {{serviceName}} randevunuzu hatırlatırız. ' +
      'Adres: {{branchName}} şubemiz. Katılımınızı aşağıdaki butonlarla bildirebilirsiniz.',
    variables: ['customerName', 'appointmentAt', 'serviceName', 'branchName'],
    examples: {
      customerName: 'Ayşe',
      appointmentAt: '24.09.2026 14:00',
      serviceName: 'Cilt bakımı',
      branchName: 'Kadıköy',
    },
    quickReplies: [
      { text: 'Onaylıyorum', action: 'confirm' },
      { text: 'İptal etmek istiyorum', action: 'cancel' },
    ],
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
  };
}
