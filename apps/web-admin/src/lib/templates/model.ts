import type {
  NotificationTemplate,
  UpsertNotificationTemplateInput,
} from '@klinara/shared';
import type { MessageKey } from '@/i18n/tr';

/**
 * Şablon sayfasının saf mantığı — bileşenden ayrı ki node'da sınanabilsin.
 */

/**
 * Olay → başlık ve açıklama anahtarı.
 *
 * Sunucu yarın bilinmeyen bir olay gönderirse başlık olayın ham adına düşer:
 * sayfa çökmez ve satır kaybolmaz.
 */
const EVENT_TEXT: Readonly<Record<string, { title: MessageKey; help: MessageKey }>> = {
  appointment_confirmation: {
    title: 'templates.event.appointment_confirmation',
    help: 'templates.event.appointment_confirmation.help',
  },
  appointment_reminder: {
    title: 'templates.event.appointment_reminder',
    help: 'templates.event.appointment_reminder.help',
  },
  appointment_cancelled: {
    title: 'templates.event.appointment_cancelled',
    help: 'templates.event.appointment_cancelled.help',
  },
  no_show_followup: {
    title: 'templates.event.no_show_followup',
    help: 'templates.event.no_show_followup.help',
  },
  package_balance: {
    title: 'templates.event.package_balance',
    help: 'templates.event.package_balance.help',
  },
  package_expiring: {
    title: 'templates.event.package_expiring',
    help: 'templates.event.package_expiring.help',
  },
  auto_reply: {
    title: 'templates.event.auto_reply',
    help: 'templates.event.auto_reply.help',
  },
};

export function eventKeys(event: string): { title: MessageKey; help: MessageKey } | undefined {
  return EVENT_TEXT[event];
}

export interface TemplateGroup {
  event: string;
  templates: NotificationTemplate[];
}

/** Olaya göre gruplar; sunucunun olay sırası ve kanal sırası korunur. */
export function groupByEvent(templates: readonly NotificationTemplate[]): TemplateGroup[] {
  const groups = new Map<string, NotificationTemplate[]>();
  for (const template of templates) {
    const list = groups.get(template.event);
    if (list === undefined) groups.set(template.event, [template]);
    else list.push(template);
  }
  return [...groups].map(([event, list]) => ({ event, templates: list }));
}

/**
 * Gönderim anahtarını çevirirken sunucuya giden gövde.
 *
 * Panel YALNIZ `isActive`i değiştirir: WhatsApp'a giden metin Meta'da onaylı
 * template'tir, buradaki gövde kaydın kopyasıdır. Metin, Meta adı, dil ve
 * konumsal eşleme olduğu gibi geri gönderilir (mobil ile aynı kural) — aksi
 * hâlde bir anahtar çevirmek eşlemeyi sessizce silerdi.
 */
export function toggleInput(
  template: NotificationTemplate,
  isActive: boolean,
): UpsertNotificationTemplateInput {
  const mapped = template.channel === 'whatsapp' && template.whatsappTemplateName !== null;
  return {
    event: template.event,
    channel: template.channel,
    locale: template.locale,
    body: template.body,
    isActive,
    // Konu yalnız e-postada; öteki kanallarda anahtarı bile sunucu 422 ile reddediyor.
    ...(template.channel === 'email' && template.subject !== null
      ? { subject: template.subject }
      : {}),
    ...(mapped && template.whatsappTemplateName !== null
      ? {
          whatsappTemplateName: template.whatsappTemplateName,
          ...(template.whatsappTemplateLanguage === null
            ? {}
            : { whatsappTemplateLanguage: template.whatsappTemplateLanguage }),
        }
      : {}),
    ...(template.channel === 'whatsapp' ? { whatsappVariables: template.whatsappVariables } : {}),
  };
}

/** Satırın anahtarı: `(olay, kanal, dil)` sunucudaki upsert anahtarıdır. */
export function templateKey(template: NotificationTemplate): string {
  return `${template.event}|${template.channel}|${template.locale}`;
}
