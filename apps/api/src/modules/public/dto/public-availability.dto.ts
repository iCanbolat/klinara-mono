import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

/** `StaffRefService`in ürettiği biçim — base64url, 22 karakter. */
export const STAFF_REF_PATTERN = /^[A-Za-z0-9_-]{22}$/;

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

  @ApiPropertyOptional({
    description:
      'Belirli bir uygulayıcıyla süz. `GET /public/sites/:slug/staff` yanıtındaki opak referans.',
  })
  @IsOptional()
  @Matches(STAFF_REF_PATTERN)
  staffRef?: string;
}

export class PublicStaffQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  @Transform(toStringArray)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  serviceIds: string[];
}

export class PublicStaffDto {
  @ApiProperty({
    description:
      'Opak ve KALICI personel referansı. UUID değildir; URL ve cache anahtarında taşınabilir.',
  })
  staffRef: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  title: string | null;

  @ApiPropertyOptional({ nullable: true })
  bio: string | null;
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

  @ApiPropertyOptional({
    description: 'Bu slotu karşılayacak uygulayıcının opak referansı (`/staff` ile aynı değer).',
  })
  staffRef?: string;
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
