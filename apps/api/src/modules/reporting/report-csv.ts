import { csvMoney, toCsv } from './csv';
import type {
  NoShowReportDto,
  OccupancyReportDto,
  RetentionReportDto,
  RevenueReportDto,
  StaffPerformanceReportDto,
} from './dto/report.dto';

/**
 * Rapor gövdesi → CSV. Saf; sorgu da HTTP de bilmiyor.
 *
 * Her raporda para İKİ kolonla yazılıyor: insan için `1.234,56` biçimli metin,
 * makine için ham kuruş. Yalnız birini yazmak iki kullanıcıdan birini
 * kaybederdi — muhasebeci Excel'de toplam almak ister, veri tarafı ondalık
 * ayracıyla uğraşmak istemez.
 */

export function occupancyCsv(report: OccupancyReportDto): string {
  return toCsv(
    ['Kırılım', 'Dolu dakika', 'Müsait dakika', 'Doluluk %'],
    report.data.map((row) => [
      row.groupLabel,
      row.bookedMinutes,
      row.availableMinutes,
      // Oran zaten yüzde; ondalık ayracı Excel için virgül olmalı.
      String(row.occupancyRate).replace('.', ','),
    ]),
  );
}

export function revenueCsv(report: RevenueReportDto): string {
  return toCsv(
    ['Kırılım', 'Tahakkuk', 'Tahakkuk (kuruş)', 'Tahsilat', 'Tahsilat (kuruş)', 'Para birimi'],
    report.data.map((row) => [
      row.groupLabel,
      csvMoney(row.accruedMinor),
      row.accruedMinor,
      csvMoney(row.collectedMinor),
      row.collectedMinor,
      report.totals.currency,
    ]),
  );
}

export function staffPerformanceCsv(report: StaffPerformanceReportDto): string {
  return toCsv(
    [
      'Personel',
      'Tamamlanan işlem',
      'Ciro',
      'Ciro (kuruş)',
      'Prim',
      'Prim (kuruş)',
      'Dolu dakika',
      'Müsait dakika',
      'Doluluk %',
    ],
    report.data.map((row) => [
      row.staffName,
      row.completedServices,
      csvMoney(row.revenueMinor),
      row.revenueMinor,
      csvMoney(row.commissionMinor),
      row.commissionMinor,
      row.bookedMinutes,
      row.availableMinutes,
      String(row.occupancyRate).replace('.', ','),
    ]),
  );
}

export function noShowCsv(report: NoShowReportDto): string {
  return toCsv(
    ['Kırılım', 'Toplam', 'Tamamlanan', 'Gelmedi', 'İptal', 'Gelmeme %', 'İptal %'],
    report.data.map((row) => [
      row.groupLabel,
      row.total,
      row.completed,
      row.noShow,
      row.cancelled,
      String(row.noShowRate).replace('.', ','),
      String(row.cancellationRate).replace('.', ','),
    ]),
  );
}

/**
 * Retention'ın CSV'si KAZANIM KAYNAĞI kırılımı.
 *
 * Kohort oranları ve toplamlar tek satırlık skalerler; onları da aynı dosyaya
 * sıkıştırmak iki farklı şekilli tabloyu üst üste yazmak olurdu ve Excel'de
 * ikisi de bozuk açılırdı. Toplamlar ekranda duruyor, dosya listeyi taşıyor.
 */
export function retentionCsv(report: RetentionReportDto): string {
  return toCsv(
    ['Geliş kaynağı', 'Müşteri'],
    report.acquisition.map((row) => [row.source ?? 'Belirtilmemiş', row.customers]),
  );
}
