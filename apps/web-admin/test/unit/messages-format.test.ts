import { describe, expect, it } from 'vitest';
import type { Conversation, ConversationMessage } from '@klinara/shared';
import {
  conversationTitle,
  deliveryState,
  formatListTime,
  formatPhone,
  groupByDay,
  initialsOf,
  renderTemplate,
  windowRemaining,
} from '../../src/lib/messages/format';

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  phone: '+905321234567',
  customer: { id: 'u1', fullName: 'Ayşe Yılmaz' },
  status: 'open',
  lastMessageAt: '2026-09-22T10:00:00Z',
  lastMessagePreview: 'Merhaba',
  lastMessageDirection: 'in',
  unread: true,
  windowOpen: true,
  windowExpiresAt: '2026-09-23T10:00:00Z',
  ...overrides,
});

const message = (createdAt: string): ConversationMessage => ({
  id: createdAt,
  direction: 'in',
  type: 'text',
  body: 'x',
  createdAt,
  status: null,
  event: null,
  sentByName: null,
  errorDetail: null,
  appointmentId: null,
});

describe('mesaj biçimlendirme', () => {
  it('TR numarasını gruplar, tanımadığını olduğu gibi bırakır', () => {
    expect(formatPhone('+905321234567')).toBe('+90 532 123 45 67');
    expect(formatPhone('+4915112345678')).toBe('+4915112345678');
  });

  it('başlık müşteri adı, yoksa numara', () => {
    expect(conversationTitle(conversation())).toBe('Ayşe Yılmaz');
    expect(conversationTitle(conversation({ customer: null }))).toBe('+90 532 123 45 67');
  });

  it('baş harfler Türkçe büyük harfle; müşterisizde #', () => {
    expect(initialsOf(conversation({ customer: { id: 'u', fullName: 'irmak ışık' } }))).toBe('İI');
    expect(initialsOf(conversation({ customer: { id: 'u', fullName: 'Deniz' } }))).toBe('D');
    expect(initialsOf(conversation({ customer: null }))).toBe('#');
  });

  it('liste zamanı: bugün saat, dün "Dün", daha eski gün + ay', () => {
    const now = new Date(2026, 8, 22, 15, 0);
    expect(formatListTime(new Date(2026, 8, 22, 9, 5).toISOString(), now)).toBe('09:05');
    expect(formatListTime(new Date(2026, 8, 21, 23, 0).toISOString(), now)).toBe('Dün');
    expect(formatListTime(new Date(2026, 8, 1, 12, 0).toISOString(), now)).toMatch(/1 Eyl/);
  });

  it('pencere süresi saat ve dakikayla; kapalı ya da geçmişse null', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    expect(windowRemaining(conversation(), now)).toBe('22 sa 0 dk');
    expect(
      windowRemaining(conversation({ windowExpiresAt: '2026-09-22T12:40:00Z' }), now),
    ).toBe('40 dk');
    expect(windowRemaining(conversation({ windowOpen: false }), now)).toBeNull();
    expect(
      windowRemaining(conversation({ windowExpiresAt: '2026-09-22T11:00:00Z' }), now),
    ).toBeNull();
  });

  it('mesajlar yerel güne göre gruplanır ve sıra korunur', () => {
    const groups = groupByDay([
      message(new Date(2026, 8, 21, 10).toISOString()),
      message(new Date(2026, 8, 21, 18).toISOString()),
      message(new Date(2026, 8, 22, 9).toISOString()),
    ]);
    expect(groups.map((group) => group.messages.length)).toEqual([2, 1]);
  });

  it('teslim durumu dört tike indirgenir', () => {
    expect(deliveryState('queued')).toBe('pending');
    expect(deliveryState('sending')).toBe('pending');
    expect(deliveryState('sent')).toBe('sent');
    expect(deliveryState('delivered')).toBe('delivered');
    expect(deliveryState('read')).toBe('read');
    expect(deliveryState('failed')).toBe('failed');
    expect(deliveryState('skipped')).toBe('failed');
  });

  it('şablon önizlemesi `{{n}}` yerine değeri koyar; boş değer yer tutucuyu korur', () => {
    const body = 'Merhaba {{1}}, {{2}} olarak size ulaşmak istedik.';
    expect(renderTemplate(body, ['Ayşe', 'Kadıköy'])).toBe(
      'Merhaba Ayşe, Kadıköy olarak size ulaşmak istedik.',
    );
    expect(renderTemplate(body, ['Ayşe', '  '])).toBe(
      'Merhaba Ayşe, {{2}} olarak size ulaşmak istedik.',
    );
  });
});
