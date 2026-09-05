import { Module } from '@nestjs/common';
import { BranchAccessModule } from '../tenancy/branch-access.module';
import { OccupancyService } from './occupancy.service';
import { PackageReportsController } from './package-reports.controller';
import { PackageReportsService } from './package-reports.service';
import { PerformanceService } from './performance.service';
import { ReportExportController } from './report-export.controller';
import { ReportScopeService } from './report-scope.service';
import { ReportsController } from './reports.controller';
import { RevenueService } from './revenue.service';
import { SnapshotService } from './snapshot.service';
import { SnapshotWorker } from './snapshot.worker';

/**
 * Raporlama — okuma dışında hiçbir şey yapmayan modül.
 *
 * `PackagesModule`den taşınan paket raporları da burada. Modülün tek yazma
 * yolu snapshot yenilemesidir ve o da kuyruk işinden tetiklenir; HTTP yüzeyi
 * tamamen `GET` (CSV dışa aktarımın `POST`u dahi yalnız okur — gövde bir
 * filtre, bir kayıt değil).
 */
@Module({
  imports: [BranchAccessModule],
  controllers: [ReportsController, ReportExportController, PackageReportsController],
  providers: [
    ReportScopeService,
    OccupancyService,
    RevenueService,
    PerformanceService,
    PackageReportsService,
    SnapshotService,
    SnapshotWorker,
  ],
})
export class ReportingModule {}
