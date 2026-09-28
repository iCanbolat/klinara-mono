import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { BookingPageModule } from '../booking-page/booking-page.module';
import {
  ConsentSignaturesController,
  ConsentTemplatesController,
  ServiceConsentTemplatesController,
} from './consent-clinic.controller';
import { ConsentSignaturesService } from './consent-signatures.service';
import { ConsentTemplatesService } from './consent-templates.service';
import { ConsentAcceptancesController, ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/**
 * Onam: KVKK/aydınlatma metni, işlem onamı şablonları ve kanıt.
 *
 *   * Online randevu: site başına tek sürümlü KVKK belgesi, kanıtı
 *     `booking_consent_acceptances`.
 *   * Klinik (0053): hasta tablete imza atar — eksikse KVKK ve hizmete bağlı
 *     işlem onamları. Kanıtı `consent_signatures` + PDF.
 *
 * Gereksinim hesabı (`consent-requirements.ts`) DI'sız: randevu durum geçişi
 * de aynı hesabı kullanıyor ve `BookingModule` bu modülü import etmiyor.
 */
@Module({
  // `BookingSiteProvisioner` için: onam metni siteye bağlı ve site kaydı ilk
  // çağrıda açılıyor. `AppointmentsService` için: imza alınan randevunun
  // erişim kontrolü (şube, uygulayıcının kendi randevusu) tek yerde.
  imports: [BookingPageModule, BookingModule],
  controllers: [
    ConsentController,
    ConsentAcceptancesController,
    ConsentTemplatesController,
    ServiceConsentTemplatesController,
    ConsentSignaturesController,
  ],
  providers: [ConsentService, ConsentTemplatesService, ConsentSignaturesService],
  exports: [ConsentService],
})
export class ConsentModule {}
