import { Module } from '@nestjs/common';
import { InternalDomainsController } from './internal-domains.controller';
import { PublicResolveController } from './public-resolve.controller';
import { PublicSiteController } from './public-site.controller';
import { PublicSiteService } from './public-site.service';
import { PublicAvailabilityService } from './public-availability.service';
import { SlotTokenService } from './slot-token.service';
import { StaffRefService } from './staff-ref.service';
import { PublicStaffService } from './public-staff.service';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';
import { BookingOtpSender } from './booking-otp.sender';
import { HoldExpiryWorker } from './hold-expiry.worker';
import { SelfServiceController } from './self-service.controller';
import { SelfServiceService } from './self-service.service';
import { PublicSiteGuard } from './public-site.guard';
import { PublicSiteResolverService } from './public-site-resolver.service';

/**
 * Public (kimlik doğrulamasız) randevu yüzeyi.
 *
 * Yönetim servislerinden AYRI: bu modüldeki hiçbir controller izin kontrolü
 * yapan bir servise erişmez, dolayısıyla "yanlışlıkla yönetim ucunu public
 * açmak" bir import hatası olarak görünür, sessiz bir güvenlik açığı olarak
 * değil.
 */
import { BookingModule } from '../booking/booking.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [BookingModule, IntegrationsModule],
  controllers: [
    PublicResolveController,
    PublicSiteController,
    PublicBookingController,
    SelfServiceController,
    InternalDomainsController,
  ],
  providers: [
    PublicSiteResolverService,
    PublicSiteGuard,
    PublicSiteService,
    PublicAvailabilityService,
    SlotTokenService,
    StaffRefService,
    PublicStaffService,
    PublicBookingService,
    BookingOtpSender,
    SelfServiceService,
    HoldExpiryWorker,
  ],
  // `PublicSiteService` dışa açılıyor: yönetim tarafındaki taslak önizleme ucu
  // aynı sunum boru hattını kullanmak zorunda. Dışa açılan tek şey SUNUM;
  // public controller'lar ve guard'lar bu modülde kalmaya devam ediyor.
  exports: [
    PublicSiteResolverService,
    PublicSiteGuard,
    SlotTokenService,
    StaffRefService,
    PublicSiteService,
  ],
})
export class PublicModule {}
