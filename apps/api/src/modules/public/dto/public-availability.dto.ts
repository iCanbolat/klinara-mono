import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsUUID } from 'class-validator';

/** `?serviceIds=a,b` ve `?serviceIds=a&serviceIds=b` — ikisi de kabul. */
const toStringArray = ({ value }: { value: unknown }): unknown => {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(','));
  if (typeof value === 'string') return value.split(',').filter((part) => part.length > 0);
  return value;
};

export class PublicAvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Sıra ANLAMLIDIR.' })
  @Transform(toStringArray)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  serviceIds: string[];

  @ApiProperty({ example: '2026-09-07T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-09-14T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  to: string;
}

export class PublicSlotDto {
  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty({
    description:
      'Slotun OPAK temsili. İçinde imzalı olarak kaynak kimliği taşır; yanıtta hiçbir UUID görünmez.',
  })
  slotToken: string;

  @ApiPropertyOptional({
    description:
      'Personel ADI — yalnız `showStaffSelection` açık ve personel online görünürken. Kimlik ASLA dönmez.',
  })
  staffName?: string;
}

export class PublicAvailabilityDto {
  @ApiProperty({ example: 'Europe/Istanbul' })
  timezone: string;

  @ApiProperty({ example: 15 })
  slotGranularityMinutes: number;

  @ApiProperty({ type: [PublicSlotDto] })
  slots: PublicSlotDto[];
}

export class PublicBranchDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  timezone: string;

  @ApiPropertyOptional({ nullable: true })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true })
  address: string | null;
}
