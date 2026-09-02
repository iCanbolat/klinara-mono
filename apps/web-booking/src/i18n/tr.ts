/**
 * Tek dil sözlüğü.
 *
 * Kütüphane yok: tek locale için `next-intl`/`i18next` bundle'ı ve runtime'ı
 * ödenmeye değmez ve 11.1'in LCP hedefine karşı çalışır. `t()` `keyof typeof`
 * ile tipli olduğu için eksik anahtar derleme zamanında yakalanıyor — asıl
 * istenen güvence bu. İkinci dil geldiğinde bu dosya bir sözlük ailesine
 * dönüşür, çağrı yerleri değişmez.
 */
export const MESSAGES = {
  'nav.book': 'Randevu al',
  'nav.services': 'Hizmetler',
  'nav.contact': 'İletişim',

  'common.loading': 'Yükleniyor…',
  'common.retry': 'Tekrar dene',
  'common.back': 'Geri',
  'common.continue': 'Devam',
  'common.close': 'Kapat',
  'common.minutes': 'dk',

  'block.services.empty': 'Şu anda online randevuya açık hizmet yok.',
  'block.contact.phone': 'Telefon',
  'block.contact.address': 'Adres',
  'block.map.load': 'Haritayı göster',

  'booking.step.branch': 'Şube',
  'booking.step.service': 'Hizmet',
  'booking.step.staff': 'Uygulayıcı',
  'booking.step.datetime': 'Tarih ve saat',
  'booking.step.identity': 'İletişim',
  'booking.step.consent': 'Onay',
  'booking.step.confirm': 'Özet',

  'booking.staff.any': 'Fark etmez',
  'booking.slot.empty': 'Bu gün için uygun saat yok.',
  'booking.hold.remaining': 'Seçtiğiniz saat sizin için tutuluyor',
  'booking.hold.expiring': 'Süre dolmak üzere',
  'booking.hold.expired': 'Tutma süresi doldu, saatler yenilendi.',
  'booking.otp.sent': 'Doğrulama kodu gönderildi.',
  'booking.otp.label': 'Doğrulama kodu',
  'booking.done.title': 'Randevunuz oluşturuldu',

  'selfservice.cancel': 'Randevuyu iptal et',
  'selfservice.reschedule': 'Saati değiştir',
  'selfservice.ics': 'Takvime ekle',
  'selfservice.expired': 'Bu bağlantının süresi dolmuş.',
  'selfservice.windowClosed': 'İptal süresi geçti. Lütfen kliniği arayın.',
} as const;

export type MessageKey = keyof typeof MESSAGES;

export function t(key: MessageKey): string {
  return MESSAGES[key];
}
