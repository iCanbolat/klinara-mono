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
  'nav.backToSite': 'Ana sayfaya dön',

  'common.loading': 'Yükleniyor…',
  'common.retry': 'Tekrar dene',
  'common.back': 'Geri',
  'common.continue': 'Devam',
  'common.close': 'Kapat',
  'common.minutes': 'dk',
  'common.change': 'Değiştir',
  'common.optional': 'isteğe bağlı',

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
  'booking.step.counter': 'Adım {current} / {total}',

  'booking.summary.title': 'Randevu özeti',
  'booking.summary.empty': 'Seçilmedi',
  'booking.summary.show': 'Özeti göster',
  'booking.summary.hide': 'Özeti gizle',

  'booking.branch.title': 'Şube seçin',
  'booking.branch.subtitle': 'Randevunuzu almak istediğiniz konumu seçin.',

  'booking.service.title': 'Hizmet seçin',
  'booking.service.subtitle': 'Birden fazla hizmet seçebilirsiniz; süreler toplanır.',
  'booking.service.selected': '{count} hizmet seçildi',

  'booking.staff.title': 'Uygulayıcı seçin',
  'booking.staff.subtitle': 'Belirli bir uygulayıcı seçebilir ya da kliniğe bırakabilirsiniz.',
  'booking.staff.any': 'Fark etmez',
  'booking.staff.anyHint': 'En uygun saatler gösterilir',

  'booking.datetime.title': 'Tarih ve saat seçin',
  'booking.datetime.subtitle': 'Saatler kliniğin saat diliminde gösteriliyor.',
  'booking.datetime.today': 'bugün',
  'booking.datetime.prevWeek': 'Önceki hafta',
  'booking.datetime.nextWeek': 'Sonraki hafta',
  'booking.datetime.morning': 'Sabah',
  'booking.datetime.afternoon': 'Öğleden sonra',
  'booking.datetime.evening': 'Akşam',
  'booking.datetime.slotCount': '{count} saat',
  'booking.datetime.nextAvailable': 'Sonraki uygun gün: {day}',
  'booking.datetime.noService': 'Önce bir hizmet seçin.',

  'booking.slot.empty': 'Bu gün için uygun saat yok.',
  'booking.hold.remaining': 'Seçtiğiniz saat sizin için tutuluyor',
  'booking.hold.expiring': 'Süre dolmak üzere',
  'booking.hold.expired': 'Tutma süresi doldu, saatler yenilendi.',

  'booking.identity.title': 'Telefon doğrulama',
  'booking.identity.subtitle': 'Randevu bilgilerinizi bu numaraya göndereceğiz.',
  'booking.identity.phone': 'Telefon numarası',
  'booking.identity.send': 'Doğrulama kodu gönder',
  'booking.identity.verify': 'Doğrula',
  'booking.identity.resend': 'Kodu tekrar gönder',
  'booking.identity.sentTo': '{phone} numarasına 6 haneli bir kod gönderdik.',
  'booking.identity.locked': '{seconds} saniye sonra yeni bir kod isteyebilirsiniz.',
  'booking.otp.sent': 'Doğrulama kodu gönderildi.',
  'booking.otp.label': 'Doğrulama kodu',
  'booking.otp.digit': '{index}. hane',

  'booking.consent.title': 'Onaylar',
  'booking.consent.subtitle': 'Devam etmek için zorunlu onayları işaretleyin.',
  'booking.consent.required': 'Zorunlu',

  'booking.confirm.title': 'Bilgileriniz',
  'booking.confirm.subtitle': 'Son bir kez kontrol edin ve randevunuzu oluşturun.',
  'booking.confirm.fullName': 'Ad soyad',
  'booking.confirm.email': 'E-posta',
  'booking.confirm.submit': 'Randevuyu oluştur',
  'booking.confirm.submitting': 'Gönderiliyor…',

  'booking.done.title': 'Randevunuz oluşturuldu',
  'booking.done.body':
    'Randevu bilgileriniz telefonunuza gönderildi. Randevunuzu aşağıdaki bağlantıdan görüntüleyebilir, değiştirebilir ya da iptal edebilirsiniz.',
  'booking.done.manage': 'Randevumu görüntüle',
  'booking.done.callClinic': 'Kliniği ara',

  'booking.error.supportCode': 'Destek kodu: {requestId}',

  'selfservice.cancel': 'Randevuyu iptal et',
  'selfservice.reschedule': 'Saati değiştir',
  'selfservice.ics': 'Takvime ekle',
  'selfservice.expired': 'Bu bağlantının süresi dolmuş.',
  'selfservice.windowClosed': 'İptal süresi geçti. Lütfen kliniği arayın.',
} as const;

export type MessageKey = keyof typeof MESSAGES;

/**
 * Yer tutucular `{ad}` biçiminde ve YALNIZ verildiğinde işleniyor: parametresiz
 * çağrılar (dosyanın çoğu) hiçbir regex maliyeti ödemesin ve mevcut çağrı
 * yerleri değişmesin.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const raw: string = MESSAGES[key];
  if (params === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
