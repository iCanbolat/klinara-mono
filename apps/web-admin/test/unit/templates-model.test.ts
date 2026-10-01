import { describe, expect, it } from 'vitest';
import { templateSegments, type NotificationTemplate } from '@klinara/shared';
import {
  eventKeys,
  groupByEvent,
  templateKey,
  toggleInput,
} from '../../src/lib/templates/model';

function template(overrides: Partial<NotificationTemplate> = {}): NotificationTemplate {
  const body = 'Merhaba {{customerName}}, {{serviceName}} randevunuz için bekleriz.';
  return {
    id: null,
    event: 'appointment_confirmation',
    channel: 'whatsapp',
    locale: 'tr',
    subject: null,
    body,
    whatsappTemplateName: 'klinara_randevu_olusturuldu_v3',
    whatsappTemplateLanguage: 'tr',
    whatsappVariables: ['customerName', 'serviceName'],
    isActive: true,
    isDefault: true,
    variables: ['customerName', 'serviceName'],
    segments: templateSegments(body),
    ...overrides,
  };
}

describe('şablon sayfası mantığı', () => {
  it('olaya göre gruplar ve sunucu sırasını korur', () => {
    const groups = groupByEvent([
      template({ event: 'appointment_reminder' }),
      template({ event: 'appointment_confirmation' }),
      template({ event: 'appointment_reminder', channel: 'email' }),
    ]);
    expect(groups.map((group) => group.event)).toEqual([
      'appointment_reminder',
      'appointment_confirmation',
    ]);
    expect(groups[0]?.templates.map((item) => item.channel)).toEqual(['whatsapp', 'email']);
  });

  it('anahtar çevirmek metni ve Meta eşlemesini OLDUĞU GİBİ geri gönderir', () => {
    const source = template();
    expect(toggleInput(source, false)).toEqual({
      event: 'appointment_confirmation',
      channel: 'whatsapp',
      locale: 'tr',
      body: source.body,
      isActive: false,
      whatsappTemplateName: 'klinara_randevu_olusturuldu_v3',
      whatsappTemplateLanguage: 'tr',
      whatsappVariables: ['customerName', 'serviceName'],
    });
  });

  it('konu yalnız e-postada gider; WhatsApp gövdesine sızmaz', () => {
    const email = template({
      event: 'auto_reply',
      channel: 'email',
      subject: '{{subject}}',
      whatsappTemplateName: null,
      whatsappTemplateLanguage: null,
      whatsappVariables: [],
    });
    const input = toggleInput(email, true);
    expect(input.subject).toBe('{{subject}}');
    expect(input).not.toHaveProperty('whatsappTemplateName');
    expect(input).not.toHaveProperty('whatsappVariables');

    expect(toggleInput(template({ subject: 'sızmamalı' }), true)).not.toHaveProperty('subject');
  });

  it('eşlemesiz WhatsApp satırında ad ve dil gönderilmez', () => {
    const input = toggleInput(
      template({ whatsappTemplateName: null, whatsappTemplateLanguage: null }),
      true,
    );
    expect(input).not.toHaveProperty('whatsappTemplateName');
    expect(input).not.toHaveProperty('whatsappTemplateLanguage');
  });

  it('satır anahtarı olay, kanal ve dilden oluşur', () => {
    expect(templateKey(template())).toBe('appointment_confirmation|whatsapp|tr');
  });

  it('bilinmeyen olay başlıksız kalır, bilinen olay anahtar verir', () => {
    expect(eventKeys('appointment_reminder')?.title).toBe('templates.event.appointment_reminder');
    expect(eventKeys('yeni_olay')).toBeUndefined();
  });
});
