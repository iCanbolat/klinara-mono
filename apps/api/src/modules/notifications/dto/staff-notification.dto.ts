import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { StaffNotificationKind } from '../../../database/schema';

const KINDS = [
  'appointment_created',
  'appointment_cancelled',
  'appointment_rescheduled',
  'inbound_message',
  'delivery_failed',
];

export class StaffNotificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: KINDS })
  kind: StaffNotificationKind;

  @ApiProperty({ example: 'Online randevu oluşturuldu' })
  title: string;

  @ApiProperty({ nullable: true, example: 'Ayşe Yılmaz · 23 Eylül 09:45 · Merkez Şube' })
  body: string | null;

  @ApiProperty({ nullable: true, description: 'Panel yolu; null ise satır tıklanamaz' })
  link: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  readAt: string | null;
}

export class StaffNotificationFeedDto {
  @ApiProperty({ type: [StaffNotificationDto] })
  data: StaffNotificationDto[];

  @ApiProperty({ example: 3 })
  unreadCount: number;
}

export class ListStaffNotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'Bu andan ESKİ bildirimler' })
  @IsOptional()
  @IsISO8601()
  before?: string;
}

export class MarkStaffNotificationsReadDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Boş bırakılırsa okunmamışların TAMAMI işaretlenir',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids?: string[];
}
