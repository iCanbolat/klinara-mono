import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CustomerPackagesController } from './customer-packages.controller';
import { CustomerPackagesService } from './customer-packages.service';
import { PackageDefinitionsController } from './package-definitions.controller';
import { PackageConsumptionService } from './package-consumption.service';
import { PackageDefinitionsService } from './package-definitions.service';
import { PackageExpiryWorker } from './package-expiry.worker';
import { PackageOperationsController } from './package-operations.controller';
import { PackageOperationsService } from './package-operations.service';
import { PackageReportsController } from './package-reports.controller';
import { PackageReportsService } from './package-reports.service';

/**
 * NOT: `customer-packages/:id` yolları `customers/:id/packages` ile aynı
 * controller'da; ayırmak iki dosyada aynı servisi enjekte etmek olurdu.
 */
@Module({
  // Paket satışı ve iadesi borcu AYNI transaction'da doğurur (6.1).
  imports: [FinanceModule],
  controllers: [
    PackageDefinitionsController,
    CustomerPackagesController,
    PackageOperationsController,
    PackageReportsController,
  ],
  providers: [
    PackageDefinitionsService,
    CustomerPackagesService,
    PackageConsumptionService,
    PackageOperationsService,
    PackageReportsService,
    PackageExpiryWorker,
  ],
  exports: [
    PackageDefinitionsService,
    CustomerPackagesService,
    PackageConsumptionService,
    PackageExpiryWorker,
  ],
})
export class PackagesModule {}
