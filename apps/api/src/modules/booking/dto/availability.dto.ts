import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AVAILABILITY_DAY_STATUSES, type AvailabilityDayStatus } from '@klinara/shared';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsOptional, IsUUID } from 'class-validator';

/** `?serviceIds=a,b` ve `?serviceIds=a&serviceIds=b` biçimlerinin ikisi de kabul edilir. */
const toStringArray = ({ value }: { value: unknown }): unknown => {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(','));
  if (typeof value === 'string') return value.split(',').filter((part) => part.length > 0);
  return value;
};

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Hizmetler GÖNDERİLEN SIRAYLA uygulanır (ardışık işlem).',
  })
  @Transform(toStringArray)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  serviceIds: string[];

  @ApiProperty({ example: '2026-09-07T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-09-08T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  to: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Yalnız bu personelin uygunluğu' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;
}

/** `GET /availability/days` — hizmet/personel bilmeden yalnız gün durumları. */
export class AvailabilityDaysQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ example: '2026-09-01T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-10-01T00:00:00+03:00', description: 'Dışlayıcı üst sınır' })
  @IsISO8601({ strict: true })
  to: string;
}

export class AvailabilityDayDto {
  @ApiProperty({ example: '2026-09-07', description: 'Şube saat diliminde yerel gün' })
  date: string;

  @ApiProperty({ enum: AVAILABILITY_DAY_STATUSES })
  status: AvailabilityDayStatus;

  @ApiProperty({ type: String, nullable: true, example: 'Cumhuriyet Bayramı' })
  holidayName: string | null;

  @ApiProperty({ type: String, nullable: true, example: '09:00' })
  opensAt: string | null;

  @ApiProperty({ type: String, nullable: true, example: '18:00' })
  closesAt: string | null;
}

export class AvailabilityDaysResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ example: 'Europe/Istanbul' })
  timezone: string;

  @ApiProperty({ type: [AvailabilityDayDto] })
  days: AvailabilityDayDto[];
}

export class AvailabilitySlotDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-07T14:00:00+03:00' })
  startsAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-07T15:00:00+03:00' })
  endsAt: string;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Bu slotu karşılayabilen personel' })
  staffProfileIds: string[];
}

export class AvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ example: 'Europe/Istanbul' })
  timezone: string;

  @ApiProperty({ example: 15 })
  slotGranularityMinutes: number;

  @ApiProperty({
    type: [AvailabilityDayDto],
    description:
      'Penceredeki her yerel gün. Boş `slots` ile `open` gün = dolu; diğer durumlar gün kuralıdır.',
  })
  days: AvailabilityDayDto[];

  @ApiProperty({ type: [AvailabilitySlotDto] })
  slots: AvailabilitySlotDto[];
}
