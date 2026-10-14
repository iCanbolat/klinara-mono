import { Global, Module } from '@nestjs/common';
import { BookingPageCacheService } from './booking-page-cache.service';

/**
 * Randevu sayfası cache purge'ü GLOBAL bir modüldür.
 *
 * `AvailabilityCacheModule` ile aynı gerekçe: sayfayı bayatlatan yazımlar tek
 * modülde toplanmıyor — personel, katalog, şube, kullanıcı üyelikleri ve sayfa
 * ayarlarının hepsi onu etkiler. Her modülün ayrı ayrı import etmesi, bir gün
 * birinin unutması demekti.
 */
@Global()
@Module({
  providers: [BookingPageCacheService],
  exports: [BookingPageCacheService],
})
export class BookingPageCacheModule {}
