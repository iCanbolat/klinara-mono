import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiProperty({ type: [AvailabilitySlotDto] })
  slots: AvailabilitySlotDto[];
}
