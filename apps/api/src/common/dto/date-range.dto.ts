import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../errors/app-error';

/**
 * Tarih aralığı — API sözleşmesi 5.5: `from`/`to`, ISO 8601 + offset, **yarı
 * açık** (`[from, to)`).
 *
 * Bu sınıf 10.1'de çıkarıldı: Faz 5'ten beri her rapor DTO'su aynı iki alanı
 * yeniden tanımlıyordu ve `assertRange` `PackageReportsService`in içinde özel
 * bir statik metot olarak duruyordu. Altı yeni rapor ucu aynı kopyayı yedinci
 * kez hak etmiyor.
 *
 * Yerel tarih (`YYYY-MM-DD`) idiomu AYRI ve bilerek öyle: takvim uçları
 * (`modules/booking/dto/calendar.dto.ts`) şubenin takviminde bir GÜN sorar,
 * raporlar ise mutlak bir AN aralığı. İkisini tek tipe indirmek, "1 Eylül"ün
 * hangi saat diliminde başladığı sorusunu belirsizleştirirdi.
 */
export class DateRangeQueryDto {
  @ApiProperty({ example: '2026-09-01T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({
    example: '2026-10-01T00:00:00+03:00',
    description: 'HARİÇ (yarı açık aralık)',
  })
  @IsISO8601({ strict: true })
  to: string;
}

/**
 * `to > from` kontrolü.
 *
 * `class-validator` ile alanlar arası bu kuralı ifade etmek özel bir
 * dekoratör gerektirirdi ve hata mesajı iki alandan hangisinin yanlış
 * olduğunu söyleyemezdi; servis girişinde tek satırlık bir kontrol daha
 * dürüst.
 */
export function assertRange(from: string, to: string): void {
  if (new Date(to).getTime() <= new Date(from).getTime()) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Aralık geçersiz', {
      detail: '`to` değeri `from` değerinden büyük olmalıdır (yarı açık aralık).',
    });
  }
}
