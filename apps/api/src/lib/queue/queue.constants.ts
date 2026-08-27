/**
 * Kuyruk adları tek yerde.
 *
 * Kuyruklar açılışta oluşturulur (pg-boss v12'de bir kuyruğa iş yazmak için
 * kuyruğun ÖNCEDEN tanımlı olması gerekir); listeyi dağıtmak, bir gün var
 * olmayan bir kuyruğa iş yazmak demekti.
 */
export const QUEUES = {
  CUSTOMER_FILE_THUMBNAIL: 'customer-file.thumbnail',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);
