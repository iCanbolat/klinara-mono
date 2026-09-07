import { Module } from '@nestjs/common';
import { BookingPageModule } from '../booking-page/booking-page.module';
import { ConsentAcceptancesController, ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/**
 * KVKK/aydınlatma onam metni ve kabul kanıtı.
 *
 * Faz 7 tek zorunlu onaya daraltıldığı için `consent_templates` /
 * `consent_records` hiç yazılmadı: site başına tek sürümlü belge ve 9.4'ten
 * devralınan (artık kalıcı) `booking_consent_acceptances` kanıt tablosu.
 */
@Module({
  // Yalnız `BookingSiteProvisioner` için: onam metni siteye bağlı ve site
  // kaydı ilk çağrıda açılıyor — ikinci bir provizyon yolu açmak, iki farklı
  // "site var mı" gerçeği demekti.
  imports: [BookingPageModule],
  controllers: [ConsentController, ConsentAcceptancesController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
