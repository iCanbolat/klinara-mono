/**
 * Rapor sözleşmesi (Batch 10.1) — API ile web istemcileri arasında paylaşılan
 * okuma tipleri.
 *
 * Bu tipler `apps/api/src/modules/reporting/dto/report.dto.ts` içindeki DTO
 * sınıflarının aynadaki karşılığıdır. OpenAPI'den kod üretilmiyor; ayrışmayı
 * `apps/api/test/unit/reports-api-contract.test.ts` DERLEME ZAMANINDA
 * yakalıyor (`SameKeys<A, B>`), yani sunucuya alan eklenip buraya yazılmazsa
 * `pnpm typecheck` kırmızıya döner.
 *
 * ⚠️ SIFIR RUNTIME BAĞIMLILIĞI: bu pakete `class-validator`, `reflect-metadata`
 * ya da swagger dekoratörleri GİREMEZ — Next istemcileri onu olduğu gibi
 * bundle'lıyor.
 */

/** Yarı açık aralık `[from, to)` — API sözleşmesi 5.5. */
export interface ReportPeriod {
  from: string;
  /** HARİÇ. */
  to: string;
}

/**
 * Yanıtın kapsamı.
 *
 * `own`, sunucunun çağıranı KENDİ personel satırına kilitlediği anlamına
 * gelir. İstemci bunu tahmin etmez, sunucudan okur ve rozeti ona göre
 * gösterir — izin listesine bakıp çıkarım yapmak, iki tarafın kuralı ayrı ayrı
 * yorumlaması demekti.
 */
export type ReportScopeKind = 'all' | 'own';

export const COMPARE_MODES = ['none', 'previous'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/**
 * Yüzde değişim. `null` "KIYASLANAMAZ" demektir (önceki dönem sıfır), `0`
 * değil — sıfırdan büyümenin yüzdesi yoktur.
 */
export type ReportDelta = Record<string, number | null>;

export const OCCUPANCY_GROUPINGS = ['staff', 'branch', 'day'] as const;
export type OccupancyGrouping = (typeof OCCUPANCY_GROUPINGS)[number];

export const REVENUE_GROUPINGS = [
  'service',
  'package',
  'staff',
  'branch',
  'day',
  'method',
] as const;
export type RevenueGrouping = (typeof REVENUE_GROUPINGS)[number];

export const NO_SHOW_GROUPINGS = ['staff', 'branch', 'service', 'day'] as const;
export type NoShowGrouping = (typeof NO_SHOW_GROUPINGS)[number];

// ---------------------------------------------------------------------------
// Doluluk
// ---------------------------------------------------------------------------

export interface OccupancyTotals {
  bookedMinutes: number;
  availableMinutes: number;
  /** Yüzde. Mesai dışı randevu varsa 100'ü AŞABİLİR. */
  occupancyRate: number;
}

export interface OccupancyRow extends OccupancyTotals {
  /** Gün kırılımında `null`: yerel tarih bir kimlik değil, etiketin kendisi. */
  groupId: string | null;
  groupLabel: string;
}

export interface OccupancyReport {
  scope: ReportScopeKind;
  period: ReportPeriod;
  totals: OccupancyTotals;
  data: OccupancyRow[];
  previous?: OccupancyTotals;
  delta?: ReportDelta;
}

// ---------------------------------------------------------------------------
// Ciro
// ---------------------------------------------------------------------------

export interface RevenueTotals {
  /** Pencerede AÇILAN ücret kalemleri. */
  accruedMinor: number;
  /** Pencerede YAPILAN, iptal edilmemiş tahsilatlar. */
  collectedMinor: number;
  refundedMinor: number;
  currency: string;
}

export interface RevenueRow {
  groupId: string | null;
  groupLabel: string;
  accruedMinor: number;
  collectedMinor: number;
}

/**
 * ⚠️ `data` satırlarının `collectedMinor` toplamı `totals.collectedMinor`DAN
 * KÜÇÜK OLABİLİR ve bu bir hata değil: eski bir borca bu dönemde yapılan
 * tahsilatın bağlanacağı kalem pencerede değildir. İstemci toplamı
 * `totals`tan okur, satırları toplayarak DEĞİL.
 */
export interface RevenueReport {
  scope: ReportScopeKind;
  period: ReportPeriod;
  totals: RevenueTotals;
  data: RevenueRow[];
  previous?: RevenueTotals;
  delta?: ReportDelta;
}

// ---------------------------------------------------------------------------
// Personel performansı
// ---------------------------------------------------------------------------

export interface StaffPerformanceRow {
  staffProfileId: string;
  staffName: string;
  completedServices: number;
  revenueMinor: number;
  /** Ters kayıtlar düşülmüş NET tahakkuk. */
  commissionMinor: number;
  bookedMinutes: number;
  availableMinutes: number;
  occupancyRate: number;
}

export interface StaffPerformanceReport {
  scope: ReportScopeKind;
  period: ReportPeriod;
  data: StaffPerformanceRow[];
  currency: string;
}

// ---------------------------------------------------------------------------
// No-show ve iptal
// ---------------------------------------------------------------------------

export interface NoShowTotals {
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
  /** Yüzde. */
  noShowRate: number;
  /** Yüzde. */
  cancellationRate: number;
}

export interface NoShowRow extends NoShowTotals {
  groupId: string | null;
  groupLabel: string;
}

export interface NoShowByOrigin extends NoShowTotals {
  origin: 'internal' | 'online';
}

export interface NoShowReport {
  period: ReportPeriod;
  totals: NoShowTotals;
  data: NoShowRow[];
  byOrigin: NoShowByOrigin[];
  previous?: NoShowTotals;
  delta?: ReportDelta;
}

// ---------------------------------------------------------------------------
// Kazanım ve retention
// ---------------------------------------------------------------------------

export interface AcquisitionRow {
  /** `customers.source`; girilmemişse `null`. */
  source: string | null;
  customers: number;
}

export interface RetentionTotals {
  /** Penceredeki İLK tamamlanmış randevusu olan müşteriler. */
  newCustomers: number;
  returningCustomers: number;
  activeCustomers: number;
  /** Yüzde. */
  returningRate: number;
}

export interface CohortReturn {
  withinDays: number;
  returned: number;
  /** Yüzde. */
  rate: number;
}

/**
 * ⚠️ `cohorts` oranları pencere BUGÜNE YAKINSA yapısal olarak düşük çıkar:
 * kohortun 90 günü henüz dolmamıştır. Sunucu bunu "düzeltmiyor" (kohortu
 * kırpmak sayının anlamını gizlerdi); istemci uyarıyı gösteriyor.
 */
export interface RetentionReport {
  period: ReportPeriod;
  totals: RetentionTotals;
  acquisition: AcquisitionRow[];
  cohorts: CohortReturn[];
  previous?: RetentionTotals;
  delta?: ReportDelta;
}

/** Dışa aktarımın sunucudaki üst sınırı; istemci uyarıyı önceden gösterebilsin. */
export const REPORT_LIMITS = {
  exportMaxRows: 50_000,
} as const;
