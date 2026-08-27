import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'completed',
  'no_show',
  'cancelled',
] as const;

export class AppointmentServiceInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ format: 'uuid', description: 'Bu hizmeti uygulayacak personel' })
  @IsUUID()
  staffProfileId: string;
}

export class CreateAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: '2026-09-07T14:00:00+03:00' })
  @IsISO8601({ strict: true })
  startsAt: string;

  @ApiProperty({
    type: [AppointmentServiceInputDto],
    description: 'Hizmetler GÖNDERİLEN SIRAYLA ardışık uygulanır.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AppointmentServiceInputDto)
  services: AppointmentServiceInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateAppointmentDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class RescheduleAppointmentDto {
  @ApiProperty({ example: '2026-09-08T10:00:00+03:00' })
  @IsISO8601({ strict: true })
  startsAt: string;

  @ApiPropertyOptional({
    type: [AppointmentServiceInputDto],
    description: 'Verilmezse mevcut hizmet ve personel dizilimi korunur.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AppointmentServiceInputDto)
  services?: AppointmentServiceInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelAppointmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ChangeAppointmentStatusDto {
  @ApiProperty({ enum: APPOINTMENT_STATUSES })
  @IsIn(APPOINTMENT_STATUSES)
  status: (typeof APPOINTMENT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AppointmentServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty({ format: 'uuid' })
  staffProfileId: string;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty({ example: 60 })
  durationMinutes: number;

  @ApiProperty({ example: 5 })
  bufferBeforeMinutes: number;

  @ApiProperty({ example: 10 })
  bufferAfterMinutes: number;

  @ApiProperty({ example: 150000, description: 'Randevu anındaki fiyat (snapshot)' })
  priceMinor: number;

  @ApiProperty({ example: 2000 })
  vatRateBasisPoints: number;
}

export class AppointmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty({ enum: APPOINTMENT_STATUSES })
  status: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-07T14:00:00+03:00' })
  startsAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-07T15:00:00+03:00' })
  endsAt: string;

  @ApiProperty({ example: 'internal' })
  origin: string;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ nullable: true, type: String })
  cancellationReason: string | null;

  @ApiProperty({ example: 1, description: 'Optimistic locking sürümü (ETag)' })
  version: number;

  @ApiProperty({ example: 150000, description: 'Kalem fiyatlarının toplamı' })
  totalMinor: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: [AppointmentServiceResponseDto] })
  services: AppointmentServiceResponseDto[];
}

export class AppointmentHistoryEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'status_changed' })
  action: string;

  @ApiProperty({ nullable: true, type: String })
  actorUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  fromStatus: string | null;

  @ApiProperty({ nullable: true, type: String })
  toStatus: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  oldStartsAt: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  newStartsAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AppointmentHistoryResponseDto {
  @ApiProperty({ type: [AppointmentHistoryEntryDto] })
  data: AppointmentHistoryEntryDto[];
}
