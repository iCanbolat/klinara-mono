import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECURRENCE_TYPES = ['none', 'weekly'] as const;

type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

export class BranchHourInputDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  openTime?: string;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  closeTime?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  breakStartTime?: string;

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  breakEndTime?: string;
}

export class BranchHourResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ minimum: 0, maximum: 6 })
  dayOfWeek: number;

  @ApiProperty()
  isClosed: boolean;

  @ApiProperty({ nullable: true, type: String, example: '09:00:00' })
  openTime: string | null;

  @ApiProperty({ nullable: true, type: String, example: '18:00:00' })
  closeTime: string | null;

  @ApiProperty({ nullable: true, type: String, example: '12:00:00' })
  breakStartTime: string | null;

  @ApiProperty({ nullable: true, type: String, example: '13:00:00' })
  breakEndTime: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class BranchHoursResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ type: [BranchHourResponseDto] })
  entries: BranchHourResponseDto[];
}

export class PutBranchHoursDto {
  @ApiProperty({ type: [BranchHourInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchHourInputDto)
  entries: BranchHourInputDto[];
}

export class StaffScheduleInputDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOff?: boolean;

  @ApiPropertyOptional({ example: '10:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  startTime?: string;

  @ApiPropertyOptional({ example: '19:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  endTime?: string;
}

export class StaffScheduleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  staffProfileId: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ minimum: 0, maximum: 6 })
  dayOfWeek: number;

  @ApiProperty()
  isOff: boolean;

  @ApiProperty({ nullable: true, type: String, example: '10:00:00' })
  startTime: string | null;

  @ApiProperty({ nullable: true, type: String, example: '19:00:00' })
  endTime: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class StaffScheduleByBranchResponseDto {
  @ApiProperty({ format: 'uuid' })
  staffProfileId: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ type: [StaffScheduleResponseDto] })
  entries: StaffScheduleResponseDto[];
}

export class PutStaffScheduleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ type: [StaffScheduleInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffScheduleInputDto)
  entries: StaffScheduleInputDto[];
}

export class ScheduleExceptionInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  staffProfileId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  endsAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ enum: RECURRENCE_TYPES, default: 'none' })
  @IsOptional()
  @IsIn(RECURRENCE_TYPES)
  recurrenceType?: RecurrenceType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  recurrenceIntervalWeeks?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  recurrenceUntil?: string;

  @ApiPropertyOptional({ type: [Number], example: [1, 3, 5] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  recurrenceWeekdays?: number[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ScheduleExceptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  staffProfileId: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ enum: RECURRENCE_TYPES })
  recurrenceType: RecurrenceType;

  @ApiProperty()
  recurrenceIntervalWeeks: number;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  recurrenceUntil: string | null;

  @ApiProperty({ type: [Number] })
  recurrenceWeekdays: number[];

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ScheduleExceptionListResponseDto {
  @ApiProperty({ type: [ScheduleExceptionResponseDto] })
  data: ScheduleExceptionResponseDto[];
}

export class ListScheduleExceptionsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
