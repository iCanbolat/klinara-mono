import type { Conversation, ConversationMessage } from '@klinara/shared';
import type { MessageKey } from '@/i18n/tr';

/**
 * Mesajlar ekranının saf yardımcıları — test edilebilsinler diye bileşenlerin
 * dışında.
 */

/** `+905321234567` → `+90 532 123 45 67`. Tanımadığı biçimi olduğu gibi bırakır. */
export function formatPhone(e164: string): string {
  const match = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  if (match === null) return e164;
  return `+90 ${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
}

/** Sohbet başlığı: müşteri adı, yoksa numara. */
export function conversationTitle(conversation: Conversation): string {
  return conversation.customer?.fullName ?? formatPhone(conversation.phone);
}

/** Avatar baş harfleri: "Ayşe Yılmaz" → "AY"; numarada "#". */
export function initialsOf(conversation: Conversation): string {
  const name = conversation.customer?.fullName;
  if (name === undefined) return '#';
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase('tr-TR') || '#';
}

const TIME = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const FULL = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Liste satırı: bugünse saat, dünse "Dün", değilse gün + ay. */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (sameDay(date, now)) return TIME.format(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Dün';
  return DAY_MONTH.format(date);
}

export function formatMessageTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** Akıştaki gün ayracı. */
export function formatDayDivider(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (sameDay(date, now)) return 'Bugün';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Dün';
  return FULL.format(date);
}

/** Mesajları gün ayraçlarıyla gruplar — sıra korunur. */
export function groupByDay(
  messages: readonly ConversationMessage[],
): { day: string; messages: ConversationMessage[] }[] {
  const groups: { day: string; messages: ConversationMessage[] }[] = [];
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const last = groups.at(-1);
    if (last?.day === key) last.messages.push(message);
    else groups.push({ day: key, messages: [message] });
  }
  return groups;
}

/**
 * Pencerenin kapanmasına kalan süre — "5 sa 12 dk". Kapalıysa `null`.
 *
 * Kesin süre gösteriliyor, "yakında kapanıyor" değil: resepsiyon "şimdi mi
 * cevaplamalıyım?" sorusunu buna bakarak cevaplıyor.
 */
export function windowRemaining(
  conversation: Pick<Conversation, 'windowOpen' | 'windowExpiresAt'>,
  now: Date = new Date(),
): string | null {
  if (!conversation.windowOpen || conversation.windowExpiresAt === null) return null;
  const ms = new Date(conversation.windowExpiresAt).getTime() - now.getTime();
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} dk`;
  return `${hours} sa ${minutes % 60} dk`;
}

/** Giden mesajın kaynağı: elle yazılmış mı, otomatik mi. */
export const EVENT_LABEL: Partial<Record<string, MessageKey>> = {
  appointment_confirmation: 'messages.event.appointmentConfirmation',
  appointment_reminder: 'messages.event.appointmentReminder',
  appointment_cancelled: 'messages.event.appointmentCancelled',
  no_show_followup: 'messages.event.noShowFollowup',
  package_balance: 'messages.event.packageBalance',
  package_expiring: 'messages.event.packageExpiring',
  auto_reply: 'messages.event.autoReply',
};

/** Gelen mesajın gövdesi yoksa (medya) gösterilecek yer tutucu. */
export const INBOUND_TYPE_LABEL: Partial<Record<string, MessageKey>> = {
  image: 'messages.type.image',
  audio: 'messages.type.audio',
  video: 'messages.type.video',
  document: 'messages.type.document',
  location: 'messages.type.location',
  sticker: 'messages.type.sticker',
};

export type DeliveryState = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Giden mesaj durumunu dört tik durumuna indirger. */
export function deliveryState(status: string | null): DeliveryState {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'skipped':
      return 'failed';
    default:
      return 'pending';
  }
}

/** Şablon önizlemesi: `{{1}}` → değer; boş değer yer tutucuyu korur. */
export function renderTemplate(body: string, values: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, index: string) => {
    const value = values[Number(index) - 1]?.trim();
    return value === undefined || value === '' ? match : value;
  });
}
