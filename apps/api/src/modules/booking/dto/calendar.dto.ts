import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { APPOINTMENT_STATUSES } from './appointment.dto';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toStatusArray = ({ value }: { value: unknown }): unknown => {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(','));
  if (typeof value === 'string') return value.split(',').filter((part) => part.length > 0);
  return value;
};

export class CalendarDayQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ example: '2026-09-07', description: 'ŞUBE saat dilimindeki yerel tarih' })
  @IsString()
  @Matches(LOCAL_DATE)
  date: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;
}

export class CalendarWeekQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ example: '2026-09-07', description: 'Haftanın ilk günü (yerel tarih)' })
  @IsString()
  @Matches(LOCAL_DATE)
  weekStart: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;
}

export class CalendarStaffQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  staffProfileId: string;

  @ApiProperty({ example: '2026-09-07T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-09-14T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  to: string;
}

export class ListAppointmentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ example: '2026-09-01T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-10-01T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUSES, isArray: true })
  @IsOptional()
  @Transform(toStatusArray)
  @IsArray()
  @IsIn(APPOINTMENT_STATUSES, { each: true })
  status?: string[];

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Önceki yanıtın pageInfo.nextCursor değeri' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class CalendarServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty()
  serviceName: string;

  @ApiProperty({ format: 'uuid' })
  staffProfileId: string;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty()
  priceMinor: number;
}

export class CalendarEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty({ example: 'Ayşe Yılmaz' })
  customerName: string;

  @ApiProperty({ nullable: true, type: String })
  customerPhone: string | null;

  @ApiProperty({ enum: APPOINTMENT_STATUSES })
  status: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-07T14:00:00+03:00' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty()
  version: number;

  @ApiProperty()
  totalMinor: number;

  @ApiProperty({ type: [CalendarServiceDto] })
  services: CalendarServiceDto[];
}

export class DensityBucketDto {
  @ApiProperty({ example: '2026-09-07' })
  localDay: string;

  @ApiProperty({ example: 14 })
  localHour: number;

  @ApiProperty({ example: 3 })
  appointmentCount: number;
}

export class CalendarResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ example: 'Europe/Istanbul' })
  timezone: string;

  @ApiProperty({ format: 'date-time' })
  from: string;

  @ApiProperty({ format: 'date-time' })
  to: string;

  @ApiProperty({ type: [CalendarEntryDto] })
  appointments: CalendarEntryDto[];

  @ApiProperty({ type: [DensityBucketDto], description: 'Yoğunluk ısı haritası verisi' })
  density: DensityBucketDto[];
}

export class PageInfoDto {
  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

export class AppointmentPageDto {
  @ApiProperty({ type: [CalendarEntryDto] })
  data: CalendarEntryDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo: PageInfoDto;
}
