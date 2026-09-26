'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PERMISSIONS,
  type CalendarEntry,
  type CalendarResponse,
  type NoShowReport,
  type Page,
  type OccupancyReport,
  type RevenueReport,
  type StaffPerformanceReport,
} from '@klinara/shared';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { api } from '@/lib/api/client';
import { todayKey } from '@/lib/calendar/date';
import {
  accessibleBranches,
  dashboardTotals,
  mergeBranchSummaries,
  mergeUpcoming,
  UPCOMING_HORIZON_DAYS,
  UPCOMING_LIMIT,
  UPCOMING_STATUSES,
  type BranchSummary,
  type DashboardTotals,
  type SummarySources,
  type UpcomingRow,
} from '@/lib/dashboard/summary';
import { toMessage } from '@/lib/reports/errors';
import { presetRange, rangeQuery } from '@/lib/reports/period';

/**
 * Karşılama sayfasının verisi — `use-report.ts` kalıbı, birden çok kaynakla.
 *
 * Birleştirme kuralları ve "neden ayrı uç yok" `lib/dashboard/summary.ts`te.
 * Burada yalnız hangi isteğin HANGİ İZİNLE atıldığı ve başarısızlığın nasıl
 * bölmelere ayrıldığı var:
 *
 * - İzni olmayan kaynak için istek HİÇ atılmıyor. 403'ü yakalayıp kartı
 *   gizlemek de aynı ekranı çizerdi, ama her açılışta konsolu ve denetim
 *   günlüğünü kırmızıya boyayarak.
 * - `Promise.allSettled`: tek bir şubenin günü ya da tek bir rapor düşerse
 *   yalnız o bölüm hata gösteriyor.
 * - Yoklama YOK. Takvim canlı bir çalışma ekranı; burası bir bakış. "Yenile"
 *   yeterli ve N+3 isteği beş saniyede bir tekrarlamak orantısız.
 */

export interface DashboardState {
  loading: boolean;
  summaries: BranchSummary[];
  /** Tüm şubelerde tarihi en yakın randevular — bugünle sınırlı değil. */
  upcoming: UpcomingRow[];
  /** Verinin çekildiği an; "bugün/yarın" etiketleri buna göre. */
  fetchedAt: number | null;
  totals: DashboardTotals;
  sources: Omit<SummarySources, 'day'>;
  /** Bu ayın personel performansı; `null` = izin yok ya da alınamadı. */
  staffPerformance: StaffPerformanceReport | null;
  /** Bölüm başına hata; `null` = sorun yok ya da istek atılmadı. */
  errors: { calendar: string | null; reports: string | null };
  can: { calendar: boolean; occupancy: boolean; revenue: boolean; staff: boolean };
  reload: () => void;
}

const EMPTY_SOURCES: Omit<SummarySources, 'day'> = { occupancy: null, revenue: null, noShow: null };

export function useDashboard(): DashboardState {
  const { me, permissions, loading: sessionLoading } = useSession();
  const { branches: allBranches, loading: branchLoading } = useBranch();
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{
    day: SummarySources['day'];
    upcoming: ReadonlyMap<string, readonly CalendarEntry[]>;
    sources: Omit<SummarySources, 'day'>;
    staffPerformance: StaffPerformanceReport | null;
    errors: DashboardState['errors'];
    fetchedAt: number;
  } | null>(null);

  const can = useMemo(
    () => ({
      calendar:
        permissions.includes(PERMISSIONS.APPOINTMENT_READ_ALL) ||
        permissions.includes(PERMISSIONS.APPOINTMENT_READ_OWN),
      occupancy: permissions.includes(PERMISSIONS.APPOINTMENT_READ_ALL),
      revenue: permissions.includes(PERMISSIONS.REPORT_REVENUE_READ),
      // Yalnız `read.own` taşıyan uygulayıcı sunucuda KENDİ satırına kilitleniyor;
      // listede tek satır görmesi doğru.
      staff:
        permissions.includes(PERMISSIONS.REPORT_REVENUE_READ) ||
        permissions.includes(PERMISSIONS.REPORT_PERFORMANCE_READ_OWN),
    }),
    [permissions],
  );

  const branches = useMemo(() => accessibleBranches(allBranches, me), [allBranches, me]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (sessionLoading || branchLoading) return;
    const controller = new AbortController();
    const { signal } = controller;

    void (async () => {
      setResult(null);

      const dayRequests = can.calendar
        ? branches.map(async (branch) => {
            // Gün ŞUBENİN saat diliminde: İstanbul şubesinin "bugün"ü Berlin'den
            // bakan yönetici için de İstanbul günü.
            const params = new URLSearchParams({
              branchId: branch.id,
              date: todayKey(branch.timezone),
            });
            const response = await api.get<CalendarResponse>(`calendar/day?${params.toString()}`, {
              signal,
              // Başlık ŞART: uç `@RequireBranchScope()` taşıyor.
              branchId: branch.id,
            });
            return [branch.id, response] as const;
          })
        : [];

      // Sıradaki randevular gün isteğinden AYRI: gün yalnız bugünü taşıyor,
      // kart ise tarihi en yakın N randevuyu istiyor (bkz. `mergeUpcoming`).
      const nowMs = Date.now();
      const upcomingQuery = new URLSearchParams({
        from: new Date(nowMs).toISOString(),
        to: new Date(nowMs + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString(),
        status: UPCOMING_STATUSES.join(','),
        limit: String(UPCOMING_LIMIT),
      });
      const upcomingRequests = can.calendar
        ? branches.map(async (branch) => {
            const params = new URLSearchParams(upcomingQuery);
            params.set('branchId', branch.id);
            const response = await api.get<Page<CalendarEntry>>(
              `appointments?${params.toString()}`,
              { signal, branchId: branch.id },
            );
            return [branch.id, response.data] as const;
          })
        : [];

      const range = presetRange('thisMonth');
      // Şube verilmiyor: sunucu "erişebildiğin tüm şubeler" için hesaplayıp
      // `groupBy=branch` ile satırlara bölüyor — kapsamı yine sunucu çözüyor.
      const query = rangeQuery(range, { groupBy: 'branch', compareTo: 'previous' });
      const report = <T>(path: string, allowed: boolean): Promise<T | null> =>
        allowed ? api.get<T>(`${path}?${query}`, { signal }) : Promise.resolve(null);

      const [days, upcomingLists, reports] = await Promise.all([
        Promise.allSettled(dayRequests),
        Promise.allSettled(upcomingRequests),
        Promise.allSettled([
          report<OccupancyReport>('reports/occupancy', can.occupancy),
          report<NoShowReport>('reports/no-show', can.occupancy),
          report<RevenueReport>('reports/revenue', can.revenue),
          // Personel kırılımı `groupBy`/`compareTo` almıyor; yalnız dönem.
          can.staff
            ? api.get<StaffPerformanceReport>(`reports/staff-performance?${rangeQuery(range)}`, {
                signal,
              })
            : Promise.resolve(null),
        ]),
      ]);
      if (signal.aborted) return;

      const day = new Map<
        string,
        { entries: CalendarResponse['appointments']; timezone: string }
      >();
      let calendarError: string | null = null;
      for (const settled of days) {
        if (settled.status === 'fulfilled') {
          const [id, response] = settled.value;
          day.set(id, { entries: response.appointments, timezone: response.timezone });
        } else {
          calendarError ??= toMessage(settled.reason);
        }
      }

      const upcoming = new Map<string, readonly CalendarEntry[]>();
      for (const settled of upcomingLists) {
        if (settled.status === 'fulfilled') {
          const [id, entries] = settled.value;
          upcoming.set(id, entries);
        } else {
          calendarError ??= toMessage(settled.reason);
        }
      }

      let reportsError: string | null = null;
      const unwrap = <T>(settled: PromiseSettledResult<T | null>): T | null => {
        if (settled.status === 'fulfilled') return settled.value;
        reportsError ??= toMessage(settled.reason);
        return null;
      };
      const [occupancy, noShow, revenue, staffPerformance] = reports;

      setResult({
        day,
        upcoming,
        sources: {
          occupancy: unwrap(occupancy),
          noShow: unwrap(noShow),
          revenue: unwrap(revenue),
        },
        staffPerformance: unwrap(staffPerformance),
        errors: { calendar: calendarError, reports: reportsError },
        fetchedAt: Date.now(),
      });
    })();

    return () => controller.abort();
  }, [sessionLoading, branchLoading, branches, can, nonce]);

  const summaries = useMemo(
    () =>
      result === null ? [] : mergeBranchSummaries(branches, { day: result.day, ...result.sources }),
    [branches, result],
  );

  const upcoming = useMemo(
    () => (result === null ? [] : mergeUpcoming(branches, result.upcoming, result.fetchedAt)),
    [branches, result],
  );

  const sources = result?.sources ?? EMPTY_SOURCES;

  return {
    loading: result === null,
    summaries,
    upcoming,
    fetchedAt: result?.fetchedAt ?? null,
    totals: dashboardTotals(summaries, sources),
    sources,
    staffPerformance: result?.staffPerformance ?? null,
    errors: result?.errors ?? { calendar: null, reports: null },
    can,
    reload,
  };
}
