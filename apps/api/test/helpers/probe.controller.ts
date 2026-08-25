import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../src/common/errors/app-error';

export const LOG_MARKER = 'benzersiz-hata-izi-42';

class ProbeBodyDto {
  @IsString()
  @MinLength(3)
  email: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  age: number;
}

/**
 * Yalnızca testlerde kullanılan uçlar: hata katmanının gerçek uygulama
 * boru hattından (guard → pipe → filtre) geçerek ölçülebilmesi için.
 */
@ApiExcludeController()
@Controller()
export class ProbeController {
  constructor(private readonly logger: PinoLogger) {}

  @Get('boom/bilinmeyen')
  unknownError(): never {
    throw new Error('veritabanı parolası hatalı: super_gizli_parola');
  }

  @Get('boom/bilinen')
  knownError(): never {
    throw AppError.conflict(ERROR_CODES.SLOT_CONFLICT, 'Seçilen saat dolu', {
      detail: 'Ayşe Yılmaz 14:00-15:00 aralığında başka bir randevuda.',
      extra: { conflicts: [{ resourceType: 'staff', resourceId: 'abc' }] },
    });
  }

  @Get('boom/izli')
  tracedError(): never {
    throw new Error(LOG_MARKER);
  }

  @Post('dogrula')
  validate(@Body() _body: ProbeBodyDto): { ok: true } {
    return { ok: true };
  }

  @Get('log-sizinti')
  leak(): { ok: true } {
    this.logger.info(
      { password: 'gizli123', phone: '+905321234567', token: 'tok_abc' },
      'hassas alanlar içeren log',
    );
    return { ok: true };
  }

  @Get('slow')
  async slow(): Promise<{ done: true }> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { done: true };
  }
}
