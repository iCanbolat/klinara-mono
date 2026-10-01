import { describe, it, expect } from 'vitest';
import { TEMPLATE_VARIABLE_HANDLES, templateSegments, variableHandle } from '@klinara/shared';
import { EVENT_DEFINITIONS } from '../../src/modules/notifications/default-templates';
import {
  STANDARD_TEMPLATES,
  positionalBody,
} from '../../src/modules/integrations/whatsapp-standard-templates';
import { whatsAppParameter } from '../../src/modules/notifications/notification-sender.worker';
import { templateVariables } from '../../src/modules/notifications/template-renderer';

describe('şablon parçaları ve @ etiketleri', () => {
  it('gövdeyi düz metin ve @Etiket parçalarına ayırır', () => {
    expect(templateSegments('Sayın {{customerName}}, {{ serviceName }} için bekleriz.')).toEqual([
      { kind: 'text', text: 'Sayın ' },
      { kind: 'variable', name: 'customerName', handle: '@MüşteriAdı' },
      { kind: 'text', text: ', ' },
      { kind: 'variable', name: 'serviceName', handle: '@HizmetAdı' },
      { kind: 'text', text: ' için bekleriz.' },
    ]);
  });

  it('değişkenle başlayan ve biten gövdede boş metin parçası üretmez', () => {
    expect(templateSegments('{{message}}')).toEqual([
      { kind: 'variable', name: 'message', handle: '@Mesaj' },
    ]);
  });

  it('tanımsız adı sessizce yutmaz, ham @ad olarak gösterir', () => {
    expect(variableHandle('bilinmeyen')).toBe('@bilinmeyen');
  });

  it('her olay değişkeninin bir @Etiketi vardır', () => {
    // Yeni bir değişken etiketsiz eklenirse ekranlar `@customerName` gibi
    // teknik bir ad gösterirdi.
    const missing = Object.values(EVENT_DEFINITIONS)
      .flatMap((definition) => definition.variables)
      .filter((name) => TEMPLATE_VARIABLE_HANDLES[name] === undefined);
    expect(missing).toEqual([]);
  });

  it('etiketler boşluksuz ve birbirinden farklıdır', () => {
    const handles = Object.values(TEMPLATE_VARIABLE_HANDLES);
    expect(handles.every((handle) => /^@[\p{L}\p{N}]+$/u.test(handle))).toBe(true);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('standart WhatsApp gövdeleri yalnız olayın tanımlı değişkenlerini kullanır', () => {
    for (const template of STANDARD_TEMPLATES) {
      if (template.event === null || template.body === undefined) continue;
      const allowed = new Set(EVENT_DEFINITIONS[template.event].variables);
      const used = templateVariables(template.body);
      expect(used.filter((name) => !allowed.has(name)), template.name).toEqual([]);
      // Meta'ya konumsal giden sıra, gövdedeki değişken kümesiyle aynı olmalı.
      expect([...template.variables].sort(), template.name).toEqual([...used].sort());
    }
  });

  it('Meta gövdesi değişkenle başlamaz/bitmez ve konumsal sıra tutarlıdır', () => {
    for (const template of STANDARD_TEMPLATES) {
      if (template.body === undefined) continue;
      const positional = positionalBody(template);
      expect(positional, template.name).not.toMatch(/^\{\{\d+\}\}/);
      expect(positional, template.name).not.toMatch(/\{\{\d+\}\}$/);
      expect(positional, template.name).not.toMatch(/\{\{[a-zA-Z]/);
    }
  });

  it('boş template parametresi Meta\'ya tire olarak gider', () => {
    expect(whatsAppParameter('')).toBe('-');
    expect(whatsAppParameter('   ')).toBe('-');
    expect(whatsAppParameter(undefined)).toBe('-');
    expect(whatsAppParameter('Kadıköy')).toBe('Kadıköy');
  });

  it('Meta biçim kuralları: örnekler sade, satır sonu ≤2, değişkenler bağlamlı', () => {
    for (const template of STANDARD_TEMPLATES) {
      if (template.body === undefined) continue;
      const label = template.name;
      // Örneklerde özel karakter reddedilme sebebi (INVALID_FORMAT).
      for (const [name, example] of Object.entries(template.examples)) {
        expect(example, `${label}.${name}`).not.toMatch(/[#$%&?]/);
        expect(example, `${label}.${name}`).not.toMatch(/\n|\t/);
      }
      // Her değişkenin örneği var ve gövdedeki her değişken tanımlı.
      expect(Object.keys(template.examples).sort(), label).toEqual([...template.variables].sort());
      // URL butonu: alan adı sabit, tek `{{1}}` sonda; örnek özel karaktersiz.
      if (template.urlButton !== undefined) {
        expect(template.urlButton.url, label).toMatch(/^https:\/\/[^{]+\{\{1\}\}$/);
        expect(template.urlButton.text.length, label).toBeLessThanOrEqual(25);
      }
      // Üç ve daha fazla ardışık satır sonu reddedilir.
      expect(template.body, label).not.toMatch(/\n{3,}/);
      // Tek başına satırdaki değişken bağlamsız sayılır.
      for (const line of template.body.split('\n')) {
        expect(line.trim(), label).not.toMatch(/^\{\{\w+\}\}$/);
      }
      // İki değişken yan yana durmaz.
      expect(template.body, label).not.toMatch(/\}\}\s*\{\{/);
    }
  });
});
