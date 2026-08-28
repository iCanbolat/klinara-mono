import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ALL_EVENTS } from '../default-templates';

export class BranchReminderSettingsDto {
  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({
    type: [Number],
    example: [24, 2],
    description: 'Randevudan kaç saat önce. Boşsa kiracı ayarı geçerlidir.',
  })
  reminderHoursBefore: number[];

  @ApiProperty({ description: 'Şube kendi saatlerini tanımladı mı' })
  isBranchOverride: boolean;

  @ApiProperty()
  noShowFollowupEnabled: boolean;

  @ApiProperty()
  noShowFollowupDelayHours: number;
}

export class UpdateBranchReminderSettingsDto {
  @ApiPropertyOptional({
    type: [Number],
    example: [24, 2],
    description: 'Boş dizi gönderilirse şube override’ı kaldırılır ve kiracı ayarı geçerli olur.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(720, { each: true })
  reminderHoursBefore?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  noShowFollowupEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 168 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(168)
  noShowFollowupDelayHours?: number;
}

export class ScheduledNotificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ALL_EVENTS })
  event: string;

  @ApiProperty({ description: 'Randevudan kaç saat önce; no-show takibinde negatif' })
  offsetHours: number;

  @ApiProperty({ format: 'date-time' })
  scheduledFor: string;

  @ApiProperty({ enum: ['pending', 'sent', 'cancelled', 'superseded'] })
  status: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  messageId: string | null;
}
