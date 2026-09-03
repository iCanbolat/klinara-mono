/**
 * Tek dilli mesaj sözlüğü — kütüphanesiz.
 *
 * `apps/web-booking/src/i18n/tr.ts` ile aynı kalıp: düz nesne, `as const`,
 * anahtar tipi `keyof typeof`. Eksik anahtar bir DERLEME hatası, çalışma
 * zamanında görünen bir `[missing]` değil.
 */

export const MESSAGES = {
  // --- Genel ---
  'app.title': 'Klinara Yönetim',
  'common.save': 'Kaydet',
  'common.cancel': 'Vazgeç',
  'common.delete': 'Sil',
  'common.close': 'Kapat',
  'common.retry': 'Tekrar dene',
  'common.refresh': 'Yenile',
  'common.loading': 'Yükleniyor…',
  'common.copy': 'Kopyala',
  'common.copied': 'Kopyalandı',
  'common.required': 'Bu alan zorunlu.',
  'common.back': 'Geri',
  'common.continue': 'Devam et',

  // --- Navigasyon ---
  'nav.page': 'Randevu sayfası',
  'nav.content': 'İçerik ve tema',
  'nav.domains': 'Alan adları',
  'nav.account': 'Hesabım',
  'nav.logout': 'Çıkış yap',
  'nav.skipToContent': 'İçeriğe geç',

  // --- Giriş ---
  'auth.login.title': 'Giriş yap',
  'auth.login.email': 'E-posta',
  'auth.login.password': 'Parola',
  'auth.login.submit': 'Giriş yap',
  'auth.login.forgot': 'Parolamı unuttum',
  'auth.login.passkey': 'Passkey ile giriş yap',
  'auth.login.passkeyFailed': 'Passkey ile giriş yapılamadı. Parolanızla deneyebilirsiniz.',
  'auth.tenant.title': 'Klinik seçin',
  'auth.tenant.description': 'Birden fazla klinikte yetkiniz var.',
  'auth.mfa.title': 'İki adımlı doğrulama',
  'auth.mfa.description': 'Uygulamanızdaki 6 haneli kodu girin.',
  'auth.mfa.code': 'Doğrulama kodu',
  'auth.mfa.submit': 'Doğrula',
  'auth.mfa.setupTitle': 'İki adımlı doğrulamayı kurun',
  'auth.mfa.setupDescription':
    'Kliniğiniz yönetici hesapları için iki adımlı doğrulamayı zorunlu tutuyor.',
  'auth.mfa.backupTitle': 'Yedek kodlarınız',
  'auth.mfa.backupDescription':
    'Bu kodları güvenli bir yere kaydedin. Bir daha gösterilmeyecek.',
  'auth.forgot.title': 'Parola sıfırlama',
  'auth.forgot.submit': 'Sıfırlama bağlantısı gönder',
  'auth.forgot.sent':
    'Bu adres kayıtlıysa sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin.',
  'auth.reset.title': 'Yeni parola belirleyin',
  'auth.reset.password': 'Yeni parola',
  'auth.reset.submit': 'Parolayı güncelle',
  'auth.reset.done': 'Parolanız güncellendi. Yeni parolanızla giriş yapabilirsiniz.',
  'auth.invite.title': 'Daveti kabul edin',
  'auth.invite.submit': 'Hesabı oluştur',
  'auth.invite.membershipAdded':
    'Hesabınıza bu klinik eklendi. Mevcut parolanızla giriş yapabilirsiniz.',
  'auth.expired.title': 'Oturumunuz sona erdi',
  'auth.expired.description':
    'Kaydedilmemiş değişiklikleriniz duruyor. Devam etmek için parolanızı girin.',
  'auth.expired.submit': 'Devam et',

  // --- Hatalar ---
  'error.title': 'Bir sorun oluştu',
  'error.forbidden': 'Bu işlem için yetkiniz yok.',
  'error.forbiddenPage': 'Bu sayfayı görüntüleme yetkiniz yok.',
  'error.notFound': 'Aradığınız kayıt bulunamadı.',
  'error.network': 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.',
  'error.rateLimited': 'Çok fazla deneme yaptınız. {seconds} saniye sonra tekrar deneyin.',
  'error.invalidCredentials': 'E-posta veya parola hatalı.',
  'error.accountLocked': 'Hesabınız çok sayıda hatalı denemeden dolayı geçici olarak kilitlendi.',
  'error.mfaInvalid': 'Doğrulama kodu hatalı veya süresi dolmuş.',
  'error.requestId': 'Destek referansı: {id}',
  'error.permissionMisconfigured':
    'Rolünüz içeriği düzenleyebiliyor ama görüntüleyemiyor. Bu bir yetki yapılandırması hatası — klinik yöneticinizle görüşün.',

  // --- Randevu sayfası ayarları ---
  'page.title': 'Randevu sayfası',
  'page.status.draft': 'Taslak',
  'page.status.published': 'Yayında',
  'page.status.unpublished': 'Yayından kaldırıldı',
  'page.canonicalUrl': 'Adres',
  'page.unpublishedChanges': 'Yayınlanmamış değişiklikler var',

  // --- İçerik editörü ---
  'editor.title': 'İçerik ve tema',
  'editor.blocks': 'Bloklar',
  'editor.theme': 'Tema',
  'editor.seo': 'SEO',
  'editor.preview': 'Önizleme',
  'editor.addBlock': 'Blok ekle',
  'editor.moveUp': '{block} bloğunu yukarı taşı',
  'editor.moveDown': '{block} bloğunu aşağı taşı',
  'editor.moved': '{block} bloğu {position}. sıraya taşındı',
  'editor.removeBlock': '{block} bloğunu sil',
  'editor.blockHidden': 'Gizli',
  'editor.publish': 'Yayınla',
  'editor.unpublish': 'Yayından kaldır',
  'editor.publishStaleness':
    'Yayın anında kaydedilir. Ziyaretçiler değişikliği genellikle birkaç saniye, en geç 5 dakika içinde görür.',
  'editor.revisions': 'Sürüm geçmişi',
  'editor.revisionCurrent': 'Yayında',
  'editor.rollback': 'Bu sürüme dön',
  'editor.conflictTitle': 'Bu sayfa başka bir kullanıcı tarafından değiştirildi',
  'editor.conflictDescription':
    'Siz düzenlerken başka biri kaydetti. Üzerine yazarsanız onun değişiklikleri kaybolur.',
  'editor.conflictOverwrite': 'Üzerine yaz',
  'editor.conflictReload': 'Yeniden yükle',
  'editor.draftRestored': 'Kaydedilmemiş değişiklikleriniz geri yüklendi.',
  'editor.readOnly': 'Bu sayfayı görüntüleyebilir ama düzenleyemezsiniz.',

  // --- Karusel ögeleri ---
  'carousel.empty': 'Henüz görsel eklenmedi.',
  'carousel.add': 'Görsel ekle',
  'carousel.item': '{position}. görsel',
  'carousel.image': '{position}. görselin kaynağı',
  'carousel.alt': 'Alternatif metin',
  'carousel.altHint': 'Görseli göremeyenler için kısa bir açıklama.',
  'carousel.caption': 'Başlık (görselin altında görünür)',
  'carousel.moveUp': '{position}. görseli yukarı taşı',
  'carousel.moveDown': '{position}. görseli aşağı taşı',
  'carousel.remove': '{position}. görseli sil',
  'carousel.moved': 'Görsel {position}. sıraya taşındı',
  'carousel.full': 'En fazla {max} görsel ekleyebilirsiniz.',

  // --- Kategori süzgeci ---
  'category.all': 'Seçim yapılmazsa online randevuya açık TÜM hizmetler listelenir.',
  'category.loading': 'Kategoriler yükleniyor…',
  'category.unavailable':
    'Kategori listesi okunamadı (hizmet okuma izniniz olmayabilir). Mevcut seçim korunuyor.',
  'category.selectedCount': '{count} kategori seçili',
  'category.unknown': 'Bilinmeyen kategori ({id})',
  'category.inactive': 'pasif',
  'category.full': 'En fazla {max} kategori seçebilirsiniz.',

  // --- Blok türleri ---
  'block.hero': 'Kapak',
  'block.richText': 'Metin',
  'block.carousel': 'Görsel galerisi',
  'block.serviceList': 'Hizmet listesi',
  'block.contact': 'İletişim',
  'block.map': 'Harita',

  // --- Varlıklar ---
  'asset.upload': 'Görsel yükle',
  'asset.uploading': 'Yükleniyor…',
  'asset.tooLarge': 'Dosya çok büyük. En fazla {mb} MB yükleyebilirsiniz.',
  'asset.wrongType': 'Bu dosya türü desteklenmiyor. JPEG, PNG, WebP veya AVIF yükleyin.',
  'asset.svgRejected': 'SVG dosyaları güvenlik nedeniyle kabul edilmiyor.',
  'asset.altText': 'Alternatif metin',

  // --- Alan adları ---
  'domains.title': 'Alan adları',
  'domains.add': 'Alan adı ekle',
  'domains.host': 'Alan adı',
  'domains.hostPlaceholder': 'randevu.klinigim.com',
  'domains.platformNote':
    'Bu adres her zaman çalışır ve silinemez; kendi alan adınız devre dışı kalsa bile sayfanız erişilebilir kalır.',
  'domains.dnsTitle': 'DNS kayıtlarını ekleyin',
  'domains.dnsDescription':
    'Alan adı sağlayıcınızın panelinde aşağıdaki kayıtlardan BİRİNİ oluşturun. Değerleri kopyalayarak yapıştırın.',
  'domains.recordType': 'Tip',
  'domains.recordName': 'Ad',
  'domains.recordValue': 'Değer',
  'domains.verifyNow': 'Şimdi doğrula',
  'domains.makePrimary': 'Birincil yap',
  'domains.makePrimaryDisabled': 'Birincil yapmak için alan adının etkinleşmesi gerekiyor.',
  'domains.remove': 'Alan adını kaldır',
  'domains.status.pending': 'DNS bekleniyor',
  'domains.status.dns_verified': 'DNS doğrulandı, sertifika bekleniyor',
  'domains.status.active': 'Etkin',
  'domains.status.failed': 'Doğrulanamadı',
  'domains.status.disabled': 'Devre dışı',
  'domains.hostTaken': 'Bu alan adı başka bir hesapta kullanılıyor.',
  'domains.checking': 'Kontrol ediliyor…',
  'domains.pollStopped': 'Otomatik kontrol durdu. Kontrolü elle tetikleyebilirsiniz.',
  'domains.diagnose.txtMissing':
    'TXT kaydı bulunamadı. Kaydı eklediyseniz DNS yayılımı bir saate kadar sürebilir.',
  'domains.diagnose.cnameMismatch': 'CNAME kaydı farklı bir hedefe işaret ediyor.',
  'domains.diagnose.propagating': 'DNS kaydı henüz yayılmamış görünüyor.',
  'domains.diagnose.unknown': 'Doğrulama başarısız oldu.',

  // --- Hesap ---
  'account.title': 'Hesabım',
  'account.security': 'Güvenlik',
  'account.changePassword': 'Parolayı değiştir',
  'account.currentPassword': 'Mevcut parola',
  'account.newPassword': 'Yeni parola',
  'account.twoFactor': 'İki adımlı doğrulama',
  'account.twoFactorOn': 'Etkin',
  'account.twoFactorOff': 'Kapalı',
  'account.passkeys': 'Passkey’ler',
  'account.addPasskey': 'Passkey ekle',
  'account.sessions': 'Açık oturumlar',
  'account.sessionCurrent': 'Bu cihaz',
  'account.logoutAll': 'Tüm cihazlardan çıkış yap',
} as const;

export type MessageKey = keyof typeof MESSAGES;

/**
 * Mesajı çöz; `{name}` yer tutucularını doldur.
 *
 * Yer tutucu regex'i yalnız parametre VERİLDİĞİNDE koşuyor — mesajların çok
 * büyük kısmında parametre yok ve her çağrıda bir regex çalıştırmanın anlamı
 * yok.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const message: string = MESSAGES[key];
  if (params === undefined) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
