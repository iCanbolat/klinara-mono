import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { BookingPageController } from './booking-page.controller';
import { BookingSiteProvisioner } from './booking-site.provisioner';
import { BookingPageService } from './booking-page.service';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { DomainVerifyWorker } from './domain-verify.worker';
import { BookingPagePurgeWorker } from './booking-page-purge.worker';
import { PublicModule } from '../public/public.module';

/**
 * Randevu sayfasının YÖNETİM yüzü — kimlik doğrulamalı, izin bazlı.
 *
 * Public yüz ayrı bir modülde (`PublicModule`): ikisinin aynı modülde durması,
 * bir gün public bir controller'a yönetim servisi enjekte edilmesini kolay ve
 * fark edilmez kılardı.
 */
@Module({
  // Yalnız `PublicSiteService` için: taslak önizleme, yayınlanmış sayfayla
  // AYNI presenter'dan geçmeli (bkz. `getDraftSite`).
  imports: [PublicModule],
  controllers: [BookingPageController, DomainsController, AssetsController],
  providers: [
    BookingSiteProvisioner,
    BookingPageService,
    DomainsService,
    AssetsService,
    DomainVerifyWorker,
    BookingPagePurgeWorker,
  ],
  exports: [BookingPageService],
})
export class BookingPageModule {}
