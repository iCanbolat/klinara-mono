/**
 * Kuyruk adları tek yerde.
 *
 * Kuyruklar açılışta oluşturulur (pg-boss v12'de bir kuyruğa iş yazmak için
 * kuyruğun ÖNCEDEN tanımlı olması gerekir); listeyi dağıtmak, bir gün var
 * olmayan bir kuyruğa iş yazmak demekti.
 */
export const QUEUES = {
  CUSTOMER_FILE_THUMBNAIL: 'customer-file.thumbnail',
  // Süre dolumu iki adımda: cron yalnız SÜPÜRÜR (kiracıları listeler), asıl iş
  // kiracı başına ayrı bir job'da, RLS altında koşar. Tek bir job'da tüm
  // kiracıları gezmek, bir kiracıdaki hatanın diğerlerini de durdurması
  // demekti.
  PACKAGE_EXPIRE_SWEEP: 'package.expire.sweep',
  PACKAGE_EXPIRE_TENANT: 'package.expire.tenant',
  // Bildirim gönderimi. İş yalnız `message_log` satırının kimliğini taşır;
  // içerik (alıcı, metin) HER ZAMAN işin kendi transaction'ında, RLS altında
  // okunur — kuyruk tablosu kişisel veri taşımaz.
  NOTIFICATION_SEND: 'notification.send',
  // Hatırlatma. İş randevuyla AYNI transaction'da yazılır (8.4): randevu
  // rollback olursa hatırlatma da olmaz.
  REMINDER_SEND: 'reminder.send',
  // Alan adı doğrulaması. Aynı iki adımlı bölünme: cron kiracıları listeler,
  // DNS sorgusu kiracı başına ayrı işte koşar — yavaş bir çözümleyici
  // diğer kiracıları bekletmesin.
  BOOKING_DOMAIN_VERIFY_SWEEP: 'booking.domain.verify.sweep',
  BOOKING_DOMAIN_VERIFY_TENANT: 'booking.domain.verify.tenant',
  // Slot tutma süresi dolduğunda rezervasyonu serbest bırakır (9.4).
  //
  // Kuyruk TEK dayanak DEĞİL: `expires_at` okuma anında da kontrol ediliyor
  // (Faz 8 hatırlatma kalıbı). Kuyruk kapalıyken de doğru davranmalı.
  BOOKING_HOLD_EXPIRE: 'booking.hold.expire',
  BOOKING_HOLD_SWEEP: 'booking.hold.sweep',
  // Yayın sonrası web istemcisinin tag cache'ini düşürür (Faz 11).
  //
  // Cron YOK: olay güdümlü. İş yayınla AYNI transaction'da yazılıyor, yani
  // pointer geri alınırsa purge de yazılmaz — "yayınlanmamış içeriği
  // yayınlanmış sanıp cache düşürmek" durumu yapısal olarak imkânsız.
  BOOKING_PAGE_PURGE: 'booking.page.purge',
  // Rapor özetleri (10.1). Aynı iki adımlı bölünme: cron kiracıları listeler,
  // hesap kiracı başına ayrı işte ve RLS altında koşar.
  //
  // Bu işler GERÇEĞİN KAYNAĞI DEĞİL — raporlar snapshot olmadan da doğru
  // çalışır, yalnız yavaşlar. Kuyruk kapalıyken hiçbir rapor bozulmaz.
  REPORT_SNAPSHOT_SWEEP: 'report.snapshot.sweep',
  REPORT_SNAPSHOT_TENANT: 'report.snapshot.tenant',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

/**
 * Zamanlanmış işler.
 *
 * Liste tek yerde: pg-boss bir zamanlamayı KENDİ ŞEMASINDA saklar ve adı
 * değişen bir zamanlama orada sonsuza dek kalıp var olmayan bir kuyruğa iş
 * yazmayı dener. Açılışta bu liste dışında kalan her zamanlama siliniyor.
 */
export interface ScheduleDefinition {
  queue: QueueName;
  cron: string;
  timezone: string;
}

export const SCHEDULES: ScheduleDefinition[] = [
  { queue: QUEUES.PACKAGE_EXPIRE_SWEEP, cron: '15 3 * * *', timezone: 'Europe/Istanbul' },
  // Klinik DNS kaydını girdikten sonra dakikalar içinde sonucu görmeli.
  { queue: QUEUES.BOOKING_DOMAIN_VERIFY_SWEEP, cron: '*/5 * * * *', timezone: 'Europe/Istanbul' },
  // Kaçan `sendAfter` işleri için emniyet süpürgesi.
  { queue: QUEUES.BOOKING_HOLD_SWEEP, cron: '*/5 * * * *', timezone: 'Europe/Istanbul' },
  // Paket süre dolumundan (03:15) SONRA: süresi dolan paketler o gece
  // kapanıyor ve rapor onları kapanmış görmeli.
  { queue: QUEUES.REPORT_SNAPSHOT_SWEEP, cron: '40 3 * * *', timezone: 'Europe/Istanbul' },
];
