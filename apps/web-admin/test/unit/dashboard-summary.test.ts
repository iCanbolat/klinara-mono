import { describe, expect, it } from 'vitest';
import type {
  Branch,
  CalendarEntry,
  NoShowReport,
  OccupancyReport,
  RevenueReport,
  StaffPerformanceReport,
} from '@klinara/shared';
import {
  accessibleBranches,
  dashboardTotals,
  mergeBranchSummaries,
  summarizeDay,
  topStaffByRevenue,
} from '../../src/lib/dashboard/summary';

const BRANCHES: Branch[] = [
  { id: 'b1', name: 'Kadıköy', timezone: 'Europe/Istanbul', isActive: true },
  { id: 'b2', name: 'Nişantaşı', timezone: 'Europe/Istanbul', isActive: true },
  { id: 'b3', name: 'Kapalı', timezone: 'Europe/Istanbul', isActive: false },
];

const NOW = Date.parse('2026-09-14T12:00:00+03:00');

const entry = (id: string, hour: number, status: string): CalendarEntry => ({
  id,
  branchId: 'b1',
  customerId: 'c',
  customerName: id,
  customerPhone: null,
  status,
  startsAt: `2026-09-14T${String(hour).padStart(2, '0')}:00:00+03:00`,
  endsAt: `2026-09-14T${String(hour).padStart(2, '0')}:30:00+03:00`,
  notes: null,
  version: 1,
  totalMinor: 0,
  services: [],
});

describe('erişilebilir şubeler', () => {
  it('kiracı geneli rol tüm AKTİF şubeleri görüyor', () => {
    expect(
      accessibleBranches(BRANCHES, { tenantWide: true, branchIds: [] }).map((b) => b.id),
    ).toEqual(['b1', 'b2']);
  });

  it('şube kapsamlı rol yalnız üyesi olduğu şubeleri görüyor', () => {
    // `GET branches` tüm kiracıyı döndürüyor; süzülmezse diğer şubeler 403 yağdırır.
    expect(
      accessibleBranches(BRANCHES, { tenantWide: false, branchIds: ['b2', 'b3'] }).map((b) => b.id),
    ).toEqual(['b2']);
  });

  it('oturum yoksa boş', () => {
    expect(accessibleBranches(BRANCHES, null)).toEqual([]);
  });
});

describe('gün özeti', () => {
  it('durumları sayıyor; sıradakiler başlamamış ve slot kaplayanlar', () => {
    const summary = summarizeDay(
      [
        entry('done', 9, 'completed'),
        entry('gone', 10, 'no_show'),
        entry('later', 16, 'confirmed'),
        entry('soon', 13, 'scheduled'),
        entry('void', 14, 'cancelled'),
      ],
      NOW,
    );
    expect(summary).toMatchObject({ total: 5, active: 3, completed: 1, noShow: 1, cancelled: 1 });
    expect(summary.upcoming.map((e) => e.id)).toEqual(['soon', 'later']);
  });
});

describe('şube birleştirme', () => {
  const occupancy = {
    totals: { bookedMinutes: 0, availableMinutes: 0, occupancyRate: 61 },
    data: [
      {
        groupId: 'b1',
        groupLabel: 'Kadıköy',
        bookedMinutes: 0,
        availableMinutes: 0,
        occupancyRate: 72,
      },
    ],
  } as unknown as OccupancyReport;
  const revenue = {
    totals: { accruedMinor: 150000, collectedMinor: 0, refundedMinor: 0, currency: 'TRY' },
    data: [{ groupId: 'b2', groupLabel: 'Nişantaşı', accruedMinor: 150000, collectedMinor: 0 }],
  } as unknown as RevenueReport;

  it('rapor geldiyse satırı olmayan şube SIFIR, rapor hiç yoksa NULL', () => {
    const summaries = mergeBranchSummaries(
      BRANCHES.slice(0, 2),
      {
        day: new Map([
          ['b1', { entries: [entry('soon', 13, 'scheduled')], timezone: 'Europe/Istanbul' }],
        ]),
        occupancy,
        revenue,
        noShow: null,
      },
      NOW,
    );

    const [kadikoy, nisantasi] = summaries;
    expect(kadikoy?.occupancyRate).toBe(72);
    expect(nisantasi?.occupancyRate).toBe(0);
    expect(kadikoy?.revenueMinor).toBe(0);
    expect(nisantasi?.revenueMinor).toBe(150000);
    expect(kadikoy?.noShowRate).toBeNull();
    expect(kadikoy?.today?.total).toBe(1);
    // Takvimi alınamayan şube "0 randevu" değil, bilinmiyor.
    expect(nisantasi?.today).toBeNull();

    const totals = dashboardTotals(summaries, { occupancy, revenue, noShow: null });
    // Oran şube ortalaması değil, sunucunun ağırlıklı toplamı.
    expect(totals).toMatchObject({
      todayTotal: 1,
      occupancyRate: 61,
      revenueMinor: 150000,
      noShowRate: null,
    });
  });

  it('hiçbir şubenin günü yoksa bugünkü toplam NULL', () => {
    const summaries = mergeBranchSummaries(
      BRANCHES.slice(0, 1),
      { day: new Map(), occupancy: null, revenue: null, noShow: null as NoShowReport | null },
      NOW,
    );
    expect(
      dashboardTotals(summaries, { occupancy: null, revenue: null, noShow: null }).todayTotal,
    ).toBeNull();
  });
});

describe('personel ciro sıralaması', () => {
  const row = (id: string, name: string, revenueMinor: number, completedServices: number) => ({
    staffProfileId: id,
    staffName: name,
    revenueMinor,
    completedServices,
    commissionMinor: 0,
    bookedMinutes: 0,
    availableMinutes: 0,
    occupancyRate: 0,
  });

  it('ciroya, eşitlikte işlem sayısına, o da eşitse ada göre sıralıyor ve kırpıyor', () => {
    const report = {
      data: [
        row('a', 'Ceren', 100, 2),
        row('b', 'Burak', 300, 1),
        row('c', 'Aylin', 100, 2),
        row('d', 'Deniz', 100, 5),
      ],
    } as unknown as StaffPerformanceReport;
    expect(topStaffByRevenue(report, 3).map((r) => r.staffName)).toEqual([
      'Burak',
      'Deniz',
      'Aylin',
    ]);
    expect(topStaffByRevenue(null)).toEqual([]);
  });
});
