import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class InboxItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Tanınmayan numarada null' })
  customerId: string | null;

  @ApiProperty({ example: '+90**********67', description: 'Numara maskeli döner' })
  from: string;

  @ApiProperty()
  messageType: string;

  @ApiPropertyOptional({ nullable: true })
  body: string | null;

  @ApiProperty({ format: 'date-time' })
  receivedAt: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  handledAt: string | null;
}

export class ListInboxQueryDto {
  @ApiPropertyOptional({ default: true, description: 'Yalnız işlenmemişler' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value !== 'false' && value !== false)
  @IsBoolean()
  onlyUnhandled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
