import type {
  NotificationChannel,
  NotificationEvent,
  NotificationKind,
} from '../../database/schema';

export interface TemplateDefinition {
  subject?: string;
  body: string;
}

export interface EventDefinition {
  kind: NotificationKind;
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
 * onaylı template gönderilebilir (mimari karar 4.6). Buradaki gövde e-posta ve
 * SMS içindir; WhatsApp için şablon satırındaki `whatsapp_template_name`
 * kullanılır (8.2).
 */
export const EVENT_DEFINITIONS: Record<NotificationEvent, EventDefinition> = {
  appointment_confirmation: {
    kind: 'transactional',
    channels: ['whatsapp', 'sms', 'email'],
    variables: ['customerName', 'branchName', 'appointmentAt', 'serviceName'],
    templates: {
      sms: { body: 'Sayın {{customerName}}, {{appointmentAt}} randevunuz oluşturuldu. {{branchName}}' },
      email: {
        subject: 'Randevunuz oluşturuldu',
        body:
          'Sayın {{customerName}},\n\n' +
          '{{appointmentAt}} tarihindeki {{serviceName}} randevunuz oluşturuldu.\n\n{{branchName}}',
      },
    },
  },
  appointment_reminder: {
    kind: 'transactional',
    channels: ['whatsapp', 'sms', 'email'],
    variables: ['customerName', 'branchName', 'appointmentAt', 'serviceName'],
    templates: {
      sms: { body: 'Sayın {{customerName}}, {{appointmentAt}} randevunuzu hatırlatırız. {{branchName}}' },
      email: {
        subject: 'Randevu hatırlatması',
        body:
          'Sayın {{customerName}},\n\n' +
          '{{appointmentAt}} tarihindeki {{serviceName}} randevunuzu hatırlatırız.\n\n{{branchName}}',
      },
    },
  },
  appointment_cancelled: {
    kind: 'transactional',
    channels: ['whatsapp', 'sms', 'email'],
    variables: ['customerName', 'branchName', 'appointmentAt'],
    templates: {
      sms: { body: 'Sayın {{customerName}}, {{appointmentAt}} randevunuz iptal edilmiştir. {{branchName}}' },
      email: {
        subject: 'Randevunuz iptal edildi',
        body: 'Sayın {{customerName}},\n\n{{appointmentAt}} tarihindeki randevunuz iptal edilmiştir.\n\n{{branchName}}',
      },
    },
  },
  no_show_followup: {
    kind: 'transactional',
    channels: ['whatsapp', 'sms'],
    variables: ['customerName', 'branchName'],
    templates: {
      sms: {
        body: 'Sayın {{customerName}}, randevunuza gelemediğinizi gördük. Yeni randevu için bize ulaşabilirsiniz. {{branchName}}',
      },
    },
  },
  package_balance: {
    kind: 'transactional',
    channels: ['whatsapp', 'sms', 'email'],
    variables: ['customerName', 'packageName', 'remainingSessions'],
    templates: {
      sms: { body: 'Sayın {{customerName}}, {{packageName}} paketinizde {{remainingSessions}} seans kaldı.' },
      email: {
        subject: 'Paket bakiyeniz',
        body: 'Sayın {{customerName}},\n\n{{packageName}} paketinizde {{remainingSessions}} seans kalmıştır.',
      },
    },
  },
  package_expiring: {
    kind: 'transactional',
    channels: ['whatsapp', 'sms', 'email'],
    variables: ['customerName', 'packageName', 'expiresAt', 'remainingSessions'],
    templates: {
      sms: {
        body: 'Sayın {{customerName}}, {{packageName}} paketiniz {{expiresAt}} tarihinde sona eriyor ({{remainingSessions}} seans).',
      },
      email: {
        subject: 'Paketinizin süresi doluyor',
        body:
          'Sayın {{customerName}},\n\n{{packageName}} paketiniz {{expiresAt}} tarihinde sona eriyor. ' +
          'Kalan seans: {{remainingSessions}}.',
      },
    },
  },
  // Doğum günü PAZARLAMA iletisidir: opt-out eden müşteriye gitmez.
  birthday: {
    kind: 'marketing',
    channels: ['whatsapp', 'sms'],
    variables: ['customerName', 'branchName'],
    templates: {
      sms: { body: 'Sayın {{customerName}}, doğum gününüzü kutlarız! {{branchName}}' },
    },
  },
  // Gelen bir buton yanıtına ANINDA verilen cevap (8.3). Pencere açıktır
  // (müşteri az önce yazdı), bu yüzden serbest metin gider.
  auto_reply: {
    kind: 'transactional',
    channels: ['whatsapp', 'sms'],
    variables: ['message'],
    templates: {
      whatsapp: { body: '{{message}}' },
      sms: { body: '{{message}}' },
    },
  },
  // Personele giden iç bildirim: sessiz saat UYGULANMAZ (bkz. dispatcher).
  staff_internal: {
    kind: 'transactional',
    channels: ['email'],
    variables: ['subject', 'message'],
    templates: {
      email: { subject: '{{subject}}', body: '{{message}}' },
    },
  },
};

export const ALL_EVENTS = Object.keys(EVENT_DEFINITIONS) as NotificationEvent[];
export const ALL_CHANNELS: NotificationChannel[] = ['whatsapp', 'sms', 'email', 'push'];
