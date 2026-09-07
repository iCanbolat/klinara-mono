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
  'nav.calendar': 'Takvim',
  'nav.customers': 'Müşteriler',
  'nav.catalog': 'Hizmetler',
  'nav.staff': 'Personel',
  'nav.schedule': 'Çalışma saatleri',
  'nav.page': 'Randevu sayfası',
  'nav.content': 'İçerik ve tema',
  'nav.domains': 'Alan adları',
  'nav.reports': 'Raporlar',
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

  // --- Klinik operasyonu (Faz 12) ---
  // Sunucunun `detail` metni bu kodlarda GELİŞTİRİCİYE yazılmış olabiliyor
  // ("resource_bookings_no_overlap ihlali"); kullanıcıya ne yapacağını
  // söyleyen metin burada.
  'error.slotConflict': 'Bu saat az önce doldu. Aşağıdaki alternatiflerden birini seçin.',
  'error.resourceUnavailable': 'Seçilen personel bu saatte müsait değil.',
  'error.outsideWorkingHours': 'Bu saat şubenin çalışma saatleri dışında.',
  'error.invalidStatusTransition': 'Randevu bu duruma bu adımdan geçirilemez.',
  'error.versionConflict': 'Bu kayıt siz açtıktan sonra değişti. Yenileyip tekrar deneyin.',
  'error.branchForbidden': 'Bu şubeye erişim yetkiniz yok.',
  'error.idempotencyConflict': 'Aynı istek farklı bilgilerle tekrar gönderildi. Sayfayı yenileyin.',
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

  // --- Raporlar (10.1) ---
  'reports.title': 'Raporlar',
  'reports.occupancy': 'Doluluk',
  'reports.occupancyHint': 'Personelin müsait dakikalarının ne kadarı dolu.',
  'reports.revenue': 'Ciro',
  'reports.revenueHint': 'Tahakkuk eden ve tahsil edilen, ayrı ayrı.',
  'reports.staffPerformance': 'Personel performansı',
  'reports.staffPerformanceHint': 'İşlem sayısı, ciro, prim ve doluluk.',
  'reports.noShow': 'Gelmeme ve iptal',
  'reports.noShowHint': 'Randevu başına gelmeme ve iptal oranı.',
  'reports.retention': 'Kazanım ve geri dönüş',
  'reports.retentionHint': 'Yeni müşteri, geri gelen müşteri ve geliş kaynağı.',
  'reports.period': 'Dönem',
  'reports.branch': 'Şube',
  'reports.allBranches': 'Tüm şubeler',
  'reports.groupBy': 'Kırılım',
  'reports.compare': 'Önceki dönemle karşılaştır',
  'reports.export': 'CSV indir',
  'reports.exporting': 'Hazırlanıyor…',
  'reports.empty': 'Bu dönemde gösterilecek veri yok.',
  'reports.scopeOwn': 'Yalnız kendi verileriniz gösteriliyor.',
  'reports.deltaUnavailable': 'Önceki dönem boş olduğu için karşılaştırılamıyor.',
  'reports.cohortWarning':
    'Kohort oranları dönem bugüne yakınsa düşük görünür: müşterilerin 90 günü henüz dolmamış olabilir.',
  'reports.revenueRowsNote':
    'Kırılım satırlarının tahsilat toplamı genel toplamdan küçük olabilir: eski bir borca bu dönemde yapılan tahsilatın bağlanacağı kalem bu dönemde değildir.',

  // Kolon başlıkları
  'reports.col.group': 'Kırılım',
  'reports.col.bookedMinutes': 'Dolu dakika',
  'reports.col.availableMinutes': 'Müsait dakika',
  'reports.col.occupancyRate': 'Doluluk',
  'reports.col.accrued': 'Tahakkuk',
  'reports.col.collected': 'Tahsilat',
  'reports.col.staff': 'Personel',
  'reports.col.completedServices': 'Tamamlanan işlem',
  'reports.col.commission': 'Prim',
  'reports.col.total': 'Toplam',
  'reports.col.completed': 'Tamamlanan',
  'reports.col.noShow': 'Gelmedi',
  'reports.col.cancelled': 'İptal',
  'reports.col.noShowRate': 'Gelmeme oranı',
  'reports.col.cancellationRate': 'İptal oranı',
  'reports.col.source': 'Geliş kaynağı',
  'reports.col.customers': 'Müşteri',
  'reports.col.cohort': 'Süre',
  'reports.col.returned': 'Geri dönen',
  'reports.col.rate': 'Oran',

  // Özet kartları
  'reports.summary.newCustomers': 'Yeni müşteri',
  'reports.summary.returningCustomers': 'Geri gelen',
  'reports.summary.activeCustomers': 'Aktif müşteri',
  'reports.summary.origin': 'Randevu kaynağı',
  'reports.origin.internal': 'Klinikten',
  'reports.origin.online': 'Online',
  'reports.sourceUnknown': 'Belirtilmemiş',

  // --- Kabuk ---
  'shell.brand': 'Klinara',
  'shell.toggleSidebar': 'Menüyü aç/kapat',
  'shell.userMenu': 'Kullanıcı menüsü',
  'shell.security': 'Güvenlik',
  'shell.branch': 'Şube',
  'shell.allBranches': 'Tüm şubeler',
  'shell.breadcrumb': 'Neredesiniz',

  // Panel kartlarının açıklamaları — menü etiketleri tek başına ne yapıldığını anlatmıyor.
  'home.greeting': 'Merhaba, {name}',
  'home.subtitle': 'Kliniğinizin online görünürlüğünü ve raporlarını buradan yönetiyorsunuz.',
  // --- Katalog / personel / plan (Faz 12.4) ---
  'catalog.title': 'Hizmetler',
  'catalog.newService': 'Yeni hizmet',
  'catalog.newCategory': 'Yeni kategori',
  'catalog.categories': 'Kategoriler',
  'catalog.name': 'Ad',
  'catalog.slug': 'Kısa ad (slug)',
  'catalog.category': 'Kategori',
  'catalog.duration': 'Süre (dk)',
  'catalog.bufferBefore': 'Hazırlık (dk)',
  'catalog.bufferAfter': 'Temizlik (dk)',
  'catalog.price': 'Fiyat',
  'catalog.vat': 'KDV (baz puan)',
  'catalog.onlineBookable': 'Online randevuya açık',
  'catalog.active': 'Aktif',
  'catalog.overrides': 'Şubeye özel değerler',
  'catalog.overridesHint':
    'Bu liste TAM DEĞİŞTİRİLİR: burada olmayan bir şube override’ı kaydettiğinizde silinir.',
  'catalog.addOverride': 'Şube ekle',
  'catalog.removeOverride': 'Şubeyi çıkar',
  'catalog.saved': 'Hizmet kaydedildi.',
  'catalog.deactivated': 'Hizmet pasife alındı.',
  'catalog.empty': 'Hizmet yok.',
  'catalog.readOnly': 'Bu ekranı görüntüleyebilirsiniz; değişiklik için yetkiniz yok.',

  'staff.title': 'Personel',
  'staff.new': 'Yeni personel',
  'staff.user': 'Kullanıcı',
  'staff.userHint': 'Personel profili MEVCUT bir kullanıcıya bağlanır; önce davet gönderin.',
  'staff.role': 'Rol',
  'staff.roleReadOnly':
    'Rol buradan değiştirilemez. Değiştirmek için kullanıcıyı pasife alıp yeniden davet edin.',
  'staff.jobTitle': 'Unvan',
  'staff.branch': 'Birincil şube',
  'staff.visibleOnline': 'Randevu sayfasında görünür',
  'staff.competency': 'Hizmet yetkinlikleri',
  'staff.competencyHint':
    'Bu liste TAM DEĞİŞTİRİLİR: işareti kaldırılan hizmet personelden silinir.',
  'staff.saved': 'Personel kaydedildi.',
  'staff.empty': 'Personel yok.',

  'schedule.title': 'Çalışma saatleri',
  'schedule.branchHours': 'Şube saatleri',
  'schedule.staffSchedule': 'Personel planı',
  'schedule.exceptions': 'İzin ve istisnalar',
  'schedule.closed': 'Kapalı',
  'schedule.off': 'İzinli',
  'schedule.open': 'Açılış',
  'schedule.close': 'Kapanış',
  'schedule.breakStart': 'Mola başı',
  'schedule.breakEnd': 'Mola sonu',
  'schedule.save': 'Haftayı kaydet',
  'schedule.saved': 'Plan kaydedildi.',
  'schedule.replaceWarning':
    'Kaydettiğinizde haftanın TAMAMI yeniden yazılır; ekranda görmediğiniz bir gün kalmaz.',
  'schedule.pickStaff': 'Personel seçin',
  'schedule.exceptionAdd': 'İstisna ekle',
  'schedule.exceptionRemove': 'Kaldır',
  'schedule.exceptionFrom': 'Başlangıç',
  'schedule.exceptionTo': 'Bitiş',
  'schedule.exceptionReason': 'Sebep',
  'schedule.exceptionsEmpty': 'İstisna yok.',
  'schedule.exceptionNoEdit':
    'İstisnalar düzenlenemez (sunucuda güncelleme ucu yok). Kaldırıp yeniden ekleyin.',
  'schedule.holidaysMissing':
    'Resmî tatiller şu an panelden yönetilemiyor; uygunluk motoru onları dikkate alıyor ama listeleme/düzenleme ucu henüz yok.',

  // --- Müşteriler (Faz 12.3) ---
  'customers.title': 'Müşteriler',
  'customers.search': 'Ara (ad veya telefon)',
  'customers.new': 'Yeni müşteri',
  'customers.empty': 'Kayıt bulunamadı.',
  'customers.loadMore': 'Daha fazla',
  'customers.name': 'Ad Soyad',
  'customers.phone': 'Telefon',
  'customers.email': 'E-posta',
  'customers.source': 'Geliş kaynağı',
  'customers.tags': 'Etiketler',
  'customers.allTags': 'Tüm etiketler',
  'customers.allSources': 'Tüm kaynaklar',
  'customers.created': 'Müşteri oluşturuldu.',
  'customers.updated': 'Müşteri güncellendi.',
  'customers.save': 'Kaydet',
  'customers.deactivate': 'Pasife al',
  'customers.deactivated': 'Müşteri pasife alındı.',
  'customers.deactivateWarning':
    'Kayıt SİLİNMİYOR, pasife alınıyor. Randevu ve paket geçmişi korunur.',
  'customers.reactivate': 'Yeniden aktifleştir',
  'customers.inactive': 'Bu kayıt pasif.',

  'customers.tab.profile': 'Künye',
  'customers.tab.notes': 'Notlar',
  'customers.tab.timeline': 'Geçmiş',
  'customers.tab.files': 'Dosyalar',

  'customers.notes.general': 'Genel',
  'customers.notes.treatment': 'Tedavi',
  'customers.notes.internal': 'İç not',
  'customers.notes.empty': 'Not yok.',
  'customers.notes.add': 'Not ekle',
  'customers.notes.body': 'Not',
  'customers.notes.medicalHidden':
    'Tedavi ve iç notlar yetkiniz dâhilinde değil — bu müşterinin böyle notu olup olmadığını göremiyorsunuz.',
  'customers.notes.stale':
    'Bu notu siz açtıktan sonra biri değiştirdi. Kaydederseniz onun değişikliği kaybolur.',
  'customers.notes.revisions': 'Sürüm geçmişi',
  'customers.notes.saved': 'Not kaydedildi.',

  'customers.timeline.empty': 'Geçmiş kaydı yok.',
  'customers.timeline.partial':
    'Bu akış yalnız randevu ve notları gösteriyor; paket ve tahsilat olayları henüz eklenmedi.',

  'customers.files.empty': 'Dosya yok.',
  'customers.files.upload': 'Dosya yükle',
  'customers.files.uploading': 'Yükleniyor…',
  'customers.files.download': 'İndir',
  'customers.files.delete': 'Sil',
  'customers.files.typeRejected': 'Bu dosya türü kabul edilmiyor (JPEG, PNG, WebP, HEIC, PDF).',
  'customers.files.uploaded': 'Dosya yüklendi.',

  'customers.merge.title': 'Mükerrer kaydı birleştir',
  'customers.merge.description':
    'Seçilen kayıt arşivlenir; randevu, paket ve tahsilatları bu kayda taşınır. GERİ ALINAMAZ.',
  'customers.merge.pick': 'Birleştirilecek (arşivlenecek) kayıt',
  'customers.merge.confirmLabel': 'Onaylamak için BİRLEŞTİR yazın',
  'customers.merge.confirmWord': 'BİRLEŞTİR',
  'customers.merge.submit': 'Birleştir',
  'customers.merge.done': 'Kayıtlar birleştirildi.',

  // --- Takvim (Faz 12.2) ---
  'calendar.title': 'Takvim',
  'calendar.day': 'Gün',
  'calendar.week': 'Hafta',
  'calendar.today': 'Bugün',
  'calendar.prev': 'Önceki',
  'calendar.next': 'Sonraki',
  'calendar.allStaff': 'Tüm personel',
  'calendar.empty': 'Bu aralıkta randevu yok.',
  'calendar.loading': 'Takvim yükleniyor…',
  'calendar.scopeOwn': 'Yalnız kendi randevularınızı görüyorsunuz.',
  'calendar.newAppointment': 'Yeni randevu',
  'calendar.refresh': 'Yenile',
  'calendar.liveStopped': 'Otomatik yenileme durdu. Listeyi elle tazeleyebilirsiniz.',

  'calendar.status.scheduled': 'Planlandı',
  'calendar.status.confirmed': 'Onaylandı',
  'calendar.status.arrived': 'Geldi',
  'calendar.status.inProgress': 'İşlemde',
  'calendar.status.completed': 'Tamamlandı',
  'calendar.status.noShow': 'Gelmedi',
  'calendar.status.cancelled': 'İptal edildi',
  'calendar.status.reopenDenied': 'Tamamlanmış randevuyu geri almak için yetkiniz yok.',

  'calendar.detail.title': 'Randevu',
  'calendar.detail.customer': 'Müşteri',
  'calendar.detail.services': 'Hizmetler',
  'calendar.detail.notes': 'Not',
  'calendar.detail.notesEmpty': 'Not yok.',
  'calendar.detail.saveNotes': 'Notu kaydet',
  'calendar.detail.history': 'Geçmiş',
  'calendar.detail.total': 'Tutar',
  'calendar.detail.close': 'Kapat',

  'calendar.action.reschedule': 'Ertele',
  'calendar.action.cancel': 'İptal et',
  'calendar.cancel.title': 'Randevuyu iptal et',
  'calendar.cancel.reason': 'İptal sebebi',
  'calendar.cancel.confirm': 'İptal et',
  'calendar.cancel.warning': 'İptal geri alınamaz. Slot serbest kalır.',

  'calendar.reschedule.title': 'Randevuyu ertele',
  'calendar.reschedule.pickDay': 'Gün',
  'calendar.reschedule.noSlots': 'Bu günde uygun saat yok.',
  'calendar.reschedule.confirm': 'Bu saate taşı',
  'calendar.conflict.title': 'Bu saat az önce doldu',
  'calendar.conflict.pickSuggestion': 'Aşağıdaki uygun saatlerden birini seçin:',
  'calendar.conflict.noSuggestions': 'Alternatif saat bulunamadı. Uygunluk yeniden sorgulandı.',

  'calendar.create.title': 'Yeni randevu',
  'calendar.create.customer': 'Müşteri',
  'calendar.create.customerPlaceholder': 'Ad veya telefon (en az 2 karakter)',
  'calendar.create.noCustomerWrite': 'Bu müşteri kayıtlı değil. Kayıt açmak için resepsiyona başvurun.',
  'calendar.create.service': 'Hizmet',
  'calendar.create.staff': 'Personel',
  'calendar.create.addService': 'Hizmet ekle',
  'calendar.create.removeService': 'Hizmeti çıkar',
  'calendar.create.slot': 'Saat',
  'calendar.create.pickSlotFirst': 'Önce hizmet ve personel seçin.',
  'calendar.create.submit': 'Randevuyu oluştur',
  'calendar.create.created': 'Randevu oluşturuldu.',
  'calendar.create.notes': 'Not (isteğe bağlı)',

  'calendar.updated': 'Randevu güncellendi.',
  'calendar.cancelled': 'Randevu iptal edildi.',
  'calendar.rescheduled': 'Randevu ertelendi.',

  'home.desc./takvim': 'Günlük ve haftalık randevu takvimi; randevu oluşturma, erteleme ve iptal.',
  'home.desc./musteriler': 'Müşteri kartı, notlar, dosyalar ve geçmiş.',
  'home.desc./katalog': 'Hizmetler, kategoriler ve şubeye özel fiyatlar.',
  'home.desc./personel': 'Personel profilleri ve hizmet yetkinlikleri.',
  'home.desc./calisma-saatleri': 'Şube saatleri, personel planı ve izinler.',
  'home.desc./sayfa': 'Randevu sayfasının adresi, görünürlüğü ve randevu davranışı.',
  'home.desc./icerik': 'Sayfa blokları, görseller, tema ve SEO ayarları.',
  'home.desc./alan-adlari': 'Kendi alan adınızı bağlayın, DNS ve sertifika durumunu izleyin.',
  'home.desc./raporlar': 'Doluluk, ciro, personel performansı, gelmeme ve kazanım.',

  // --- Durumlar ---
  'state.emptyTitle': 'Burada henüz bir şey yok',
  'state.errorTitle': 'Bir şeyler ters gitti',
  'state.errorBody': 'İşlem tamamlanamadı. Tekrar deneyebilir ya da sayfayı yenileyebilirsiniz.',
  'state.notFoundTitle': 'Sayfa bulunamadı',
  'state.notFoundBody': 'Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.',
  'state.backHome': 'Panele dön',

  // --- Bildirimler ---
  'toast.saved': 'Kaydedildi',
  'toast.copied': 'Panoya kopyalandı',
  'toast.exported': 'Dosya indiriliyor',
  'toast.failed': 'İşlem başarısız',

  // --- Randevu sayfası ayarları ---
  'page.noDomain': 'Henüz bir alan adı yok.',
  'page.behaviour': 'Randevu davranışı',
  'page.showStaffSelection': 'Uygulayıcı seçimi gösterilsin',
  'page.showPrices': 'Fiyatlar gösterilsin',
  'page.allowReschedule': 'Erteleme yapılabilsin',
  'page.requireOtp': 'Telefon doğrulaması (OTP) zorunlu',
  'page.holdTtlMinutes': 'Slot tutma süresi (dakika)',
  'editor.revision': 'sürüm {number}',
  'editor.seoTitle': 'Başlık',
  'editor.seoDescription': 'Açıklama',
  'editor.selectBlock': 'Düzenlemek için bir blok seçin.',
  'editor.primaryColor': 'Birincil renk',
  'editor.backgroundColor': 'Arka plan',
  'editor.textColor': 'Metin rengi',
  'editor.fontFamily': 'Yazı tipi',
  'editor.radius': 'Köşe yarıçapı',
  'editor.logo': 'Logo',
  'editor.published': 'Sayfa yayınlandı',

  // Geri alınamaz eylemlerin onayları
  'account.removePasskeyTitle': 'Passkey silinsin mi?',
  'account.removePasskeyBody':
    'Bu cihazla bir daha passkey ile giriş yapamazsınız. İşlem geri alınamaz.',
  'account.revokeSessionTitle': 'Oturum sonlandırılsın mı?',
  'account.revokeSessionBody':
    'Bu cihazdaki oturum kapatılır ve yeniden giriş yapılması gerekir.',
  'account.logoutAllTitle': 'Tüm cihazlardan çıkılsın mı?',
  'account.logoutAllBody':
    'Bu oturum dışındaki bütün oturumlar kapatılır. Ekibinizin yeniden giriş yapması gerekir.',
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
