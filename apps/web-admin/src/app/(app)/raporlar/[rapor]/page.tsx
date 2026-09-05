'use client';

import { notFound, useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { NoShowReportView } from '@/components/reports/no-show-report';
import { OccupancyReportView } from '@/components/reports/occupancy-report';
import { RetentionReportView } from '@/components/reports/retention-report';
import { RevenueReportView } from '@/components/reports/revenue-report';
import { StaffPerformanceReportView } from '@/components/reports/staff-performance-report';
import { PermissionGate } from '@/components/session/permission-gate';

/**
 * Tek rapor sayfası.
 *
 * Rota parametresi TÜRKÇE bir slug ve sözlükte olmayan bir değer `notFound()`
 * veriyor — dinamik bir segmentin altına yazılan her şey bir React bileşenine
 * dönüşmemeli.
 *
 * ⚠️ Buradaki `PermissionGate` bir güvenlik sınırı DEĞİL, kullanılabilirlik
 * katmanı: gerçek kontrol API'nin `PermissionsGuard`ında ve doğrudan URL ile
 * gelen izinsiz kullanıcı zaten 403 alıyor. Kapı, o kullanıcıya boş bir grafik
 * yerine anlaşılır bir panel göstermek için.
 */

const REPORTS: Record<string, { anyOf: readonly string[]; render: () => ReactNode }> = {
  doluluk: {
    anyOf: [PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN],
    render: () => <OccupancyReportView />,
  },
  ciro: {
    anyOf: [PERMISSIONS.REPORT_REVENUE_READ],
    render: () => <RevenueReportView />,
  },
  personel: {
    anyOf: [PERMISSIONS.REPORT_REVENUE_READ, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN],
    render: () => <StaffPerformanceReportView />,
  },
  gelmeme: {
    anyOf: [PERMISSIONS.APPOINTMENT_READ_ALL],
    render: () => <NoShowReportView />,
  },
  kazanim: {
    anyOf: [PERMISSIONS.APPOINTMENT_READ_ALL],
    render: () => <RetentionReportView />,
  },
};

export default function Page(): ReactNode {
  const params = useParams<{ rapor: string }>();
  const report = REPORTS[params.rapor];
  if (report === undefined) notFound();

  return (
    <PermissionGate required={[]} anyOf={report.anyOf}>
      {report.render()}
    </PermissionGate>
  );
}
