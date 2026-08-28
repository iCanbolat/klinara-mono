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
];
