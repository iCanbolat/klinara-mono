import { Module } from '@nestjs/common';
import { ChargeGenerationService } from './charge-generation.service';

/**
 * Finans modülü — yalnız borç kalemlerinin OTOMATİK doğuşu.
 *
 * Uç yok: tahsilat, kasa, prim ve indirim 0045 ile kapsamdan çıktı. Kalan
 * `ChargeGenerationService` randevu ve paket akışlarının KENDİ
 * transaction'larında koşar; ciro raporları `charges`ı doğrudan okur.
 * Bağımlılık yönü tek yönlüdür — `BookingModule` ve `PackagesModule` buraya
 * bakar, bu modül onlara bakmaz.
 */
@Module({
  providers: [ChargeGenerationService],
  exports: [ChargeGenerationService],
})
export class FinanceModule {}
