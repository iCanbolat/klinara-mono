import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import {
  NO_SHOW_GROUPINGS,
  OCCUPANCY_GROUPINGS,
  REPORT_LIMITS,
  REVENUE_GROUPINGS,
  type AcquisitionRow,
  type CohortReturn,
  type NoShowByOrigin,
  type NoShowReport,
  type NoShowRow,
  type NoShowTotals,
  type OccupancyReport,
  type OccupancyRow,
  type OccupancyTotals,
  type RetentionReport,
  type RetentionTotals,
  type RevenueReport,
  type RevenueRow,
  type RevenueTotals,
  type StaffPerformanceReport,
  type StaffPerformanceRow,
} from '@klinara/shared';
import {
  AcquisitionRowDto,
  CohortReturnDto,
  NoShowByOriginDto,
  NoShowReportDto,
  NoShowRowDto,
  NoShowTotalsDto,
  OccupancyReportDto,
  OccupancyRowDto,
  OccupancyTotalsDto,
  RetentionReportDto,
  RetentionTotalsDto,
  RevenueReportDto,
  RevenueRowDto,
  RevenueTotalsDto,
  StaffPerformanceReportDto,
  StaffPerformanceRowDto,
} from '../../src/modules/reporting/dto/report.dto';
import { REPORT_EXPORT_MAX_ROWS } from '../../src/modules/reporting/report-export.controller';

/**
 * Rapor API'si iki yerde temsil ediliyor: `dto/report.dto.ts` sınıfları
 * (doğrulama + Swagger) ve `@klinara/shared`teki `reports-api.ts` arayüzleri
 * (web istemcileri). `admin-api-contract.test.ts`teki kalıbın aynısı.
 *
 * Kontrol İKİ YÖNLÜ olmak zorunda — tek yön ("shared'da fazla alan var mı")
 * DTO'ya eklenen fazladan bir alanı sessizce geçirirdi ve korkulan yön tam
 * olarak odur: sunucuya alan eklendi, istemci sözleşmesine yazılmadı.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : { eksik: Exclude<keyof B, keyof A> }
  : { fazla: Exclude<keyof A, keyof B> };

const _keysOccupancyTotals: SameKeys<OccupancyTotalsDto, OccupancyTotals> = true;
const _keysOccupancyRow: SameKeys<OccupancyRowDto, OccupancyRow> = true;
const _keysOccupancyReport: SameKeys<OccupancyReportDto, OccupancyReport> = true;
const _keysRevenueTotals: SameKeys<RevenueTotalsDto, RevenueTotals> = true;
const _keysRevenueRow: SameKeys<RevenueRowDto, RevenueRow> = true;
const _keysRevenueReport: SameKeys<RevenueReportDto, RevenueReport> = true;
const _keysStaffRow: SameKeys<StaffPerformanceRowDto, StaffPerformanceRow> = true;
const _keysStaffReport: SameKeys<StaffPerformanceReportDto, StaffPerformanceReport> = true;
const _keysNoShowTotals: SameKeys<NoShowTotalsDto, NoShowTotals> = true;
const _keysNoShowRow: SameKeys<NoShowRowDto, NoShowRow> = true;
const _keysNoShowByOrigin: SameKeys<NoShowByOriginDto, NoShowByOrigin> = true;
const _keysNoShowReport: SameKeys<NoShowReportDto, NoShowReport> = true;
const _keysAcquisition: SameKeys<AcquisitionRowDto, AcquisitionRow> = true;
const _keysRetentionTotals: SameKeys<RetentionTotalsDto, RetentionTotals> = true;
const _keysCohort: SameKeys<CohortReturnDto, CohortReturn> = true;
const _keysRetentionReport: SameKeys<RetentionReportDto, RetentionReport> = true;

/** Değer düzeyinde atanabilirlik — alan TİPLERİ de uyuşmalı, yalnız adlar değil. */
const _occupancyToShared: OccupancyTotals = new OccupancyTotalsDto();
const _revenueToShared: RevenueTotals = new RevenueTotalsDto();
const _staffRowToShared: StaffPerformanceRow = new StaffPerformanceRowDto();
const _noShowToShared: NoShowTotals = new NoShowTotalsDto();
const _retentionToShared: RetentionTotals = new RetentionTotalsDto();
const _cohortToShared: CohortReturn = new CohortReturnDto();

describe('rapor sözleşmesi', () => {
  it('derleme zamanı kontrolleri geçti', () => {
    // Yukarıdaki `= true` atamaları tip hatası olsaydı `pnpm typecheck`
    // kırılırdı; bu test onların GERÇEKTEN değerlendirildiğini sabitliyor.
    // Hepsi tek tek doğrulanıyor: biri okunmadan bırakılırsa `noUnusedLocals`
    // zaten kırılır, ama listeyi burada tutmak hangi tipin kapsandığını da
    // görünür kılıyor.
    for (const check of [
      _keysOccupancyTotals,
      _keysOccupancyRow,
      _keysOccupancyReport,
      _keysRevenueTotals,
      _keysRevenueRow,
      _keysRevenueReport,
      _keysStaffRow,
      _keysStaffReport,
      _keysNoShowTotals,
      _keysNoShowRow,
      _keysNoShowByOrigin,
      _keysNoShowReport,
      _keysAcquisition,
      _keysRetentionTotals,
      _keysCohort,
      _keysRetentionReport,
    ]) {
      expect(check).toBe(true);
    }
    expect(_occupancyToShared).toBeInstanceOf(OccupancyTotalsDto);
    expect(_revenueToShared).toBeInstanceOf(RevenueTotalsDto);
    expect(_staffRowToShared).toBeInstanceOf(StaffPerformanceRowDto);
    expect(_noShowToShared).toBeInstanceOf(NoShowTotalsDto);
    expect(_retentionToShared).toBeInstanceOf(RetentionTotalsDto);
    expect(_cohortToShared).toBeInstanceOf(CohortReturnDto);
  });

  it('gruplama demetleri TEK kaynaktan geliyor', () => {
    // DTO'lar bu demetleri `@klinara/shared`ten import ediyor; burada yalnız
    // içeriklerinin beklenen kırılımlar olduğunu sabitliyoruz.
    expect([...OCCUPANCY_GROUPINGS]).toEqual(['staff', 'branch', 'day']);
    expect([...REVENUE_GROUPINGS]).toEqual([
      'service',
      'package',
      'staff',
      'branch',
      'day',
      'method',
    ]);
    expect([...NO_SHOW_GROUPINGS]).toEqual(['staff', 'branch', 'service', 'day']);
  });

  it('dışa aktarım üst sınırı istemciyle AYNI sayı', () => {
    // İstemci uyarıyı sınıra basmadan gösterebilsin diye paylaşılıyor; iki
    // sayının ayrışması "indir dedim, 400 aldım" demekti.
    expect(REPORT_LIMITS.exportMaxRows).toBe(REPORT_EXPORT_MAX_ROWS);
  });
});
