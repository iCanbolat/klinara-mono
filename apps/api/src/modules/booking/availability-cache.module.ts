import { Global, Module } from '@nestjs/common';
import { AvailabilityCacheService } from './availability-cache.service';

/**
 * Uygunluk cache'i GLOBAL bir modüldür.
 *
 * Sebebi: uygunluğu etkileyen yazımlar tek bir modülde toplanmıyor — katalog
 * (süre/buffer), personel (yetkinlik), takvim kuralları (çalışma saati,
 * istisna) ve randevu uçlarının hepsi onu bayatlatır. Her modülün ayrı ayrı
 * booking modülünü import etmesi, bir gün birinin import etmeyi UNUTMASI
 * demekti; unutulan invalidasyon ise kullanıcıya "dolu görünen boş slot"
 * olarak döner.
 */
@Global()
@Module({
  providers: [AvailabilityCacheService],
  exports: [AvailabilityCacheService],
})
export class AvailabilityCacheModule {}
