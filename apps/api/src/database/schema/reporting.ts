import { date, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { branches, tenants } from './tenancy';

/**
 * Hangi rapor snapshot'lanıyor (`0039`).
 *
 * `pgEnum` DEĞİL, `text` + check: bu bir iş alanı değil bir uygulama detayı ve
 * rapor eklemek/çıkarmak bir enum migration'ını hak etmiyor.
 */
export const SNAPSHOT_REPORT_NAMES = ['occupancy', 'revenue'] as const;
export type SnapshotReportName = (typeof SNAPSHOT_REPORT_NAMES)[number];

export const SNAPSHOT_GROUP_KINDS = ['total', 'staff', 'service', 'package', 'source'] as const;
export type SnapshotGroupKind = (typeof SNAPSHOT_GROUP_KINDS)[number];

/** Doluluk kovasının ölçüleri. */
export interface OccupancyMetrics {
  bookedMinutes: number;
  availableMinutes: number;
}

/** Ciro kovasının ölçüleri — hepsi minor unit tamsayısı. */
export interface RevenueMetrics {
  accruedMinor: number;
  collectedMinor: number;
  refundedMinor: number;
  appointments: number;
}

export type SnapshotMetrics = OccupancyMetrics | RevenueMetrics;

/**
 * Ağır raporların günlük özeti — TÜRETİLMİŞ veri.
 *
 * Materialized view DEĞİL, ve bu bilinçli: matview RLS'e uymaz ve
 * `security_invoker` karşılığı yoktur (gerekçe `0026` ve `0039` başlıklarında).
 * Gerçek bir tablo olduğu için snapshot yolu canlı sorgu yoluyla aynı
 * izolasyonun altında.
 */
export const reportSnapshots = pgTable(
  'report_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reportName: text('report_name').$type<SnapshotReportName>().notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** Şube YEREL günü — `branches.timezone`e göre. */
    bucketDate: date('bucket_date').notNull(),
    groupKind: text('group_kind').$type<SnapshotGroupKind>().notNull(),
    /** `total` kırılımında ve `source` gibi kimliksiz kırılımlarda NULL. */
    groupId: uuid('group_id'),
    groupLabel: text('group_label').notNull(),
    metrics: jsonb('metrics').$type<SnapshotMetrics>().notNull(),
    /** Hesabın anı — bayatlığı kullanıcıya söyleyebilmek için. */
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('report_snapshots_read_idx').on(
      table.tenantId,
      table.reportName,
      table.branchId,
      table.bucketDate,
    ),
  ],
);
