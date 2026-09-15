import {
  isAppointmentStatus,
  type Branch,
  type CalendarEntry,
  type Me,
  type NoShowReport,
  type OccupancyReport,
  type RevenueReport,
  type StaffPerformanceReport,
  type StaffPerformanceRow,
} from '@klinara/shared';
import { occupiesSlot } from '@/lib/calendar/status';

/**
 * Karşılama sayfasının özeti — saf, React'siz.
 *
 * ---------------------------------------------------------------------------
 * NEDEN AYRI BİR UÇ YOK
 * ---------------------------------------------------------------------------
 * Özet mevcut uçlardan İSTEMCİDE birleştiriliyor: şube başına `calendar/day`
 * ve `groupBy=branch` ile üç rapor. Bir kliniğin şube sayısı tek haneli; N+3
 * istek bir sunucu ucu, DTO'su, sözleşme testi ve proxy kuralı eklemekten
 * ucuz. Şube sayısı büyürse doğru adım `GET dashboard/summary` — o gün bu
 * dosyadaki birleştirme kuralları sunucuya taşınacak kural listesidir.
 *
 * Her kaynak AYRI başarısız olabiliyor: ciro izni olmayan resepsiyon ya da
 * zaman aşımına düşen tek bir rapor, şube kartlarını boşaltmamalı. Bu yüzden
 * birleştirmede eksik veri `null` — "sıfır" değil. Sıfır bir ölçümdür,
 * `null` "bilinmiyor".
 */

export interface DaySummary {
  total: number;
  /** Slot kaplayanlar — iptal ve gelmedi hariç. */
  active: number;
  completed: number;
  noShow: number;
  cancelled: number;
  /** Henüz başlamamış, slot kaplayan randevular; başlangıca göre sıralı. */
  upcoming: CalendarEntry[];
}

export interface BranchSummary {
  branch: Branch;
  /** `null`: takvim izni yok ya da o şubenin günü alınamadı. */
  today: DaySummary | null;
  timezone: string;
  occupancyRate: number | null;
  revenueMinor: number | null;
  currency: string | null;
  noShowRate: number | null;
}

export interface DashboardTotals {
  todayTotal: number | null;
  todayActive: number | null;
  todayCompleted: number | null;
  occupancyRate: number | null;
  revenueMinor: number | null;
  currency: string | null;
  noShowRate: number | null;
}

/**
 * Kullanıcının GERÇEKTEN erişebildiği şubeler.
 *
 * `GET branches` kiracının TÜM şubelerini döndürüyor (RLS kiracıyla sınırlı,
 * üyelikle değil). Şube kapsamlı bir resepsiyonist için her şubeye
 * `calendar/day` atmak, erişemediği şubelerden 403 yağdırmak olurdu.
 * Pasif şubeler de dışarıda: kapanmış bir şubenin "bugün 0 randevu" kartı
 * bilgi değil gürültü.
 */
export function accessibleBranches(
  branches: readonly Branch[],
  me: Pick<Me, 'tenantWide' | 'branchIds'> | null,
): Branch[] {
  if (me === null) return [];
  const active = branches.filter((branch) => branch.isActive !== false);
  if (me.tenantWide) return active;
  const allowed = new Set(me.branchIds);
  return active.filter((branch) => allowed.has(branch.id));
}

export function summarizeDay(
  entries: readonly CalendarEntry[],
  nowMs: number,
  upcomingLimit = 5,
): DaySummary {
  let active = 0;
  let completed = 0;
  let noShow = 0;
  let cancelled = 0;
  const upcoming: CalendarEntry[] = [];

  for (const entry of entries) {
    const status = isAppointmentStatus(entry.status) ? entry.status : 'scheduled';
    if (occupiesSlot(status)) active += 1;
    if (status === 'completed') completed += 1;
    if (status === 'no_show') noShow += 1;
    if (status === 'cancelled') cancelled += 1;
    if (occupiesSlot(status) && status !== 'completed' && Date.parse(entry.startsAt) >= nowMs) {
      upcoming.push(entry);
    }
  }

  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return {
    total: entries.length,
    active,
    completed,
    noShow,
    cancelled,
    upcoming: upcoming.slice(0, upcomingLimit),
  };
}

export interface SummarySources {
  /** Şube kimliği → o şubenin bugünkü randevuları ve saat dilimi. */
  day: ReadonlyMap<string, { entries: readonly CalendarEntry[]; timezone: string }>;
  occupancy: OccupancyReport | null;
  revenue: RevenueReport | null;
  noShow: NoShowReport | null;
}

export function mergeBranchSummaries(
  branches: readonly Branch[],
  sources: SummarySources,
  nowMs: number,
): BranchSummary[] {
  const occupancy = rowsById(sources.occupancy?.data);
  const revenue = rowsById(sources.revenue?.data);
  const noShow = rowsById(sources.noShow?.data);

  return branches.map((branch) => {
    const day = sources.day.get(branch.id);
    // Rapor geldiyse ama şubenin satırı yoksa o dönemde veri YOK demektir —
    // sıfır. Rapor hiç gelmediyse bilinmiyor — `null`.
    const revenueRow = revenue.get(branch.id);
    return {
      branch,
      today: day === undefined ? null : summarizeDay(day.entries, nowMs),
      timezone: day?.timezone ?? branch.timezone,
      occupancyRate:
        sources.occupancy === null ? null : (occupancy.get(branch.id)?.occupancyRate ?? 0),
      revenueMinor: sources.revenue === null ? null : (revenueRow?.accruedMinor ?? 0),
      currency: sources.revenue?.totals.currency ?? null,
      noShowRate: sources.noShow === null ? null : (noShow.get(branch.id)?.noShowRate ?? 0),
    };
  });
}

/**
 * KPI şeridi. Oranlar şube ortalaması DEĞİL, raporun kendi `totals`ından:
 * 10 randevulu şubeyle 200 randevulu şubenin oranını eşit ağırlıkla
 * ortalamak yanlış bir sayı üretir; sunucu zaten doğru ağırlıkla hesaplıyor.
 */
export function dashboardTotals(
  summaries: readonly BranchSummary[],
  sources: Pick<SummarySources, 'occupancy' | 'revenue' | 'noShow'>,
): DashboardTotals {
  const days = summaries.map((summary) => summary.today).filter((day) => day !== null);
  const sum = (pick: (day: DaySummary) => number): number | null =>
    days.length === 0 ? null : days.reduce((total, day) => total + pick(day), 0);

  return {
    todayTotal: sum((day) => day.total),
    todayActive: sum((day) => day.active),
    todayCompleted: sum((day) => day.completed),
    occupancyRate: sources.occupancy?.totals.occupancyRate ?? null,
    revenueMinor: sources.revenue?.totals.accruedMinor ?? null,
    currency: sources.revenue?.totals.currency ?? null,
    noShowRate: sources.noShow?.totals.noShowRate ?? null,
  };
}

export type BranchMetric = 'today' | 'occupancy' | 'revenue' | 'noShow';

/** Şube grafiğinin bir satırı; bilinmeyen değer grafikte 0 çiziliyor. */
export interface BranchChartRow {
  id: string;
  name: string;
  completed: number;
  /** Slot kaplayan ama henüz tamamlanmamış. */
  pending: number;
  /** İptal ve gelmedi. */
  dropped: number;
  occupancy: number;
  revenue: number;
  noShow: number;
}

export function branchChartRows(summaries: readonly BranchSummary[]): BranchChartRow[] {
  return summaries.map((summary) => ({
    id: summary.branch.id,
    name: summary.branch.name,
    completed: summary.today?.completed ?? 0,
    pending: summary.today === null ? 0 : summary.today.active - summary.today.completed,
    dropped: summary.today === null ? 0 : summary.today.total - summary.today.active,
    occupancy: summary.occupancyRate ?? 0,
    revenue: summary.revenueMinor ?? 0,
    noShow: summary.noShowRate ?? 0,
  }));
}

/**
 * Grafikte seçilebilir göstergeler — bilinen değeri olanlar, sabit sırayla.
 * Bir gösterge ya tüm şubelerde bilinir ya hiçbirinde (aynı rapordan geliyor);
 * bugün ise şube şube düşebildiği için "en az bir şubede" yeterli.
 */
export function availableBranchMetrics(summaries: readonly BranchSummary[]): BranchMetric[] {
  const first = summaries[0];
  if (first === undefined) return [];
  const metrics: BranchMetric[] = [];
  if (summaries.some((summary) => summary.today !== null)) metrics.push('today');
  if (first.occupancyRate !== null) metrics.push('occupancy');
  if (first.revenueMinor !== null) metrics.push('revenue');
  if (first.noShowRate !== null) metrics.push('noShow');
  return metrics;
}

/**
 * Personel ciro sıralaması — en çok ciro yapan önce.
 *
 * Raporun satır sırası tablo içindir; karşılama sayfasının sorusu ise "bu ay
 * kim ne kadar getirdi". Eşitlikte tamamlanan
 * işlem sayısı, o da eşitse ad: sıra her yenilemede aynı kalmalı.
 */
export function topStaffByRevenue(
  report: StaffPerformanceReport | null,
  limit = 6,
): StaffPerformanceRow[] {
  if (report === null) return [];
  return [...report.data]
    .sort(
      (a, b) =>
        b.revenueMinor - a.revenueMinor ||
        b.completedServices - a.completedServices ||
        a.staffName.localeCompare(b.staffName, 'tr'),
    )
    .slice(0, limit);
}

function rowsById<T extends { groupId: string | null }>(
  rows: readonly T[] | undefined,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows ?? []) {
    if (row.groupId !== null) map.set(row.groupId, row);
  }
  return map;
}
