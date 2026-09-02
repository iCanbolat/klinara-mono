import { Body, Controller, Delete, HttpCode, HttpStatus, Headers, Ip, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@klinara/shared';
import { Public } from '../../common/decorators/auth.decorators';
import { AppError } from '../../common/errors/app-error';
import { PublicThrottlerGuard } from '../../common/guards/public-throttler.guard';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PublicBookingService } from './public-booking.service';
import { PublicSiteGuard } from './public-site.guard';
import { siteOf } from './public-site.controller';
import {
  CreateHoldDto,
  HoldResponseDto,
  PublicCreateAppointmentDto,
  RequestOtpDto,
  VerifyOtpDto,
} from './dto/public-booking.dto';

@ApiTags('public')
@Controller('public/sites/:slug')
@Public()
@UseGuards(PublicThrottlerGuard, PublicSiteGuard)
export class PublicBookingController {
  constructor(
    private readonly booking: PublicBookingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('holds')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Slotu tut',
    description:
      'Tutma `resource_bookings`a yazılır ve randevunun kullandığı AYNI EXCLUDE constraint’i tarafından korunur. İki eş zamanlı istekten biri `SLOT_CONFLICT` alır.',
  })
  createHold(
    @Req() request: Request,
    @Body() body: CreateHoldDto,
    @Ip() ip: string,
  ): Promise<HoldResponseDto> {
    return this.booking.createHold(siteOf(request), body.slotToken, {
      ip: ip === '' ? null : ip,
      userAgent: null,
    });
  }

  @Delete('holds/:holdToken')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Tutmayı serbest bırak' })
  release(@Req() request: Request, @Param('holdToken') holdToken: string): Promise<void> {
    return this.booking.releaseHold(siteOf(request), holdToken);
  }

  @Post('holds/:holdToken/otp')
  // Doğrudan faturaya yazan uç: kendi sınırı, uygulama içi tavanların ÜSTÜNE.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Doğrulama kodu iste',
    description: 'Kod bildirim çekirdeğinden GEÇMEZ — sessiz saat ertelemesi randevu akışını kırardı.',
  })
  requestOtp(
    @Req() request: Request,
    @Param('holdToken') holdToken: string,
    @Body() body: RequestOtpDto,
    @Ip() ip: string,
  ): Promise<{ sentAt: string; expiresAt: string }> {
    return this.booking.requestOtp(siteOf(request), holdToken, body.phone, {
      ip: ip === '' ? null : ip,
      userAgent: null,
    });
  }

  @Post('holds/:holdToken/otp/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kodu doğrula' })
  verifyOtp(
    @Req() request: Request,
    @Param('holdToken') holdToken: string,
    @Body() body: VerifyOtpDto,
  ): Promise<{ verified: true }> {
    return this.booking.verifyOtp(siteOf(request), holdToken, body.code);
  }

  @Post('appointments')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Randevu oluştur',
    description:
      '`Idempotency-Key` ZORUNLUDUR: ağ hatasında tekrar gönderim mükerrer randevu üretmemeli.',
  })
  async create(
    @Req() request: Request,
    @Body() body: PublicCreateAppointmentDto,
    @Ip() ip: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ appointmentId: string; manageToken: string }> {
    // İç uçta anahtar OPSİYONEL; burada zorunlu. Public tarafta istemci bir
    // tarayıcı ve tekrar gönderim (kullanıcı butona iki kez bastı, ağ koptu)
    // istisna değil kural.
    if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Idempotency-Key başlığı zorunlu');
    }

    const site = siteOf(request);
    const meta = { ip: ip === '' ? null : ip, userAgent: userAgent ?? null };
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.CREATED,
      body: await this.booking.createAppointment(site, body, meta),
    }));
    return result.body;
  }
}
