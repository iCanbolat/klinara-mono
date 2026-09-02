import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { PublicThrottlerGuard } from '../../common/guards/public-throttler.guard';
import { PublicSiteGuard } from './public-site.guard';
import { siteOf } from './public-site.controller';
import { SelfServiceService, type SelfServiceView } from './self-service.service';

export class SelfServiceCancelDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class SelfServiceRescheduleDto {
  @ApiProperty({ description: 'Uygunluk ucundan gelen opak slot token’ı.' })
  @IsString()
  @MaxLength(2_000)
  slotToken: string;
}

/**
 * Müşterinin kendi randevusunu yönettiği yüzey.
 *
 * Token TEK randevuya kapsanmıştır, süreli ve sayaçlıdır; `sha256` ile
 * saklanır. Bir müşteri kartını açmaz — kapsam veri modeliyle sınırlanmıştır,
 * sunum katmanıyla değil (bkz. `SelfServiceService`).
 *
 * Uçlar site slug'ı altında duruyor çünkü kiracı çözümlemesi ayarları
 * (iptal penceresi, erteleme izni) okumak için gerekiyor ve `PublicSiteGuard`
 * o işi zaten yapıyor.
 */
@ApiTags('public')
@Controller('public/sites/:slug/appointments')
@Public()
@UseGuards(PublicThrottlerGuard, PublicSiteGuard)
export class SelfServiceController {
  constructor(private readonly selfService: SelfServiceService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Randevumu göster',
    description:
      'Yanıt randevu saati, hizmet adları, şube adresi ve klinik telefonundan ibarettir. Tıbbi not, geçmiş randevu ve paket bakiyesi DÖNMEZ.',
  })
  view(@Req() request: Request, @Param('token') token: string): Promise<SelfServiceView> {
    return this.selfService.view(siteOf(request), token);
  }

  @Post(':token/cancel')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Randevumu iptal et',
    description: 'İptal penceresi kapalıysa reddedilir ve klinik iletişim bilgisi gösterilir.',
  })
  cancel(
    @Req() request: Request,
    @Param('token') token: string,
    @Body() body: SelfServiceCancelDto,
  ): Promise<SelfServiceView> {
    return this.selfService.cancel(siteOf(request), token, body.reason);
  }

  @Post(':token/reschedule')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Randevumu ertele',
    description:
      'İptal + yeni randevu DEĞİL: aynı kaydın taşınmasıdır, randevu kimliği ve geçmişi korunur.',
  })
  reschedule(
    @Req() request: Request,
    @Param('token') token: string,
    @Body() body: SelfServiceRescheduleDto,
  ): Promise<SelfServiceView> {
    return this.selfService.reschedule(siteOf(request), token, body.slotToken);
  }

  @Get(':token/ics')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Takvime ekle (.ics)' })
  async ics(
    @Req() request: Request,
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const body = await this.selfService.ics(siteOf(request), token);
    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="randevu.ics"');
    response.setHeader('Cache-Control', 'no-store');
    return body;
  }
}
