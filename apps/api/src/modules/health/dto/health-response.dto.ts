import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';

  @ApiProperty({ description: 'Sürecin ayakta olduğu süre (saniye)', example: 42 })
  uptimeSeconds: number;
}

export class ReadinessChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database: 'up' | 'down';
}

export class ReadinessResponseDto {
  @ApiProperty({ enum: ['ready', 'not_ready'] })
  status: 'ready' | 'not_ready';

  @ApiProperty({ type: ReadinessChecksDto })
  checks: ReadinessChecksDto;

  @ApiProperty({ nullable: true, example: '0005_tenancy.sql' })
  migrationVersion: string | null;
}
