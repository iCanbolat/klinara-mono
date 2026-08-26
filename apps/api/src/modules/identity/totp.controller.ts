import { Body, Controller, Delete, HttpCode, HttpStatus, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { Public, SelfService } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { contextOf } from '../../common/request-context';
import { TotpService } from './totp.service';
import { TokenService } from './token.service';
import type { Principal } from './principal';
import { requestMeta } from './request-meta';
import {
  BackupCodesResponseDto,
  TotpCodeDto,
  TotpSetupResponseDto,
  TotpStatusResponseDto,
  VerifyMfaDto,
} from './dto/mfa.dto';
import { LoginResponseDto } from './dto/auth-response.dto';

/**
 * TOTP (opsiyonel ikinci faktör).
 *
 * `setup` ve `enable` iki farklı token'ı kabul eder: normal durumda oturum
 * açmış kullanıcının access token'ı, kiracı 2FA'yı ZORUNLU kıldığı hâlde
 * kullanıcının henüz kurulum yapmadığı durumda ise giriş akışındaki `mfa` ara
 * token'ı. İkincisi olmasaydı zorunluluk açıldığı anda o kullanıcılar
 * hesaplarına giremezdi: kurulum için oturum, oturum için kurulum gerekirdi.
 *
 * Ara token'ın yetkisi BUNUNLA SINIRLIDIR — kurulumu tamamlamak tek başına
 * oturum açmaz, ardından `verify` çağrılmalıdır.
 */
@ApiTags('auth')
@Controller('auth/2fa')
export class TotpController {
  constructor(
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
  ) {}

  private async actorOf(request: Request): Promise<string> {
    const ctx = contextOf(request);
    // Middleware geçerli bir access token gördüyse kullanıcı zaten çözülmüştür.
    if (ctx?.userId != null) return ctx.userId;

    const header = request.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (bearer === '') throw AppError.unauthenticated();

    const claims = await this.tokens.verify(bearer, 'mfa');
    return claims.sub;
  }

  @Get()
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'İki adımlı doğrulama durumu' })
  @ApiOkResponse({ type: TotpStatusResponseDto })
  status(@CurrentUser() principal: Principal): Promise<TotpStatusResponseDto> {
    return this.totp.status(principal.userId);
  }

  @Post('setup')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({
    summary: 'TOTP kurulumunu başlat (QR sırrı üretir)',
    description: 'Access token veya giriş akışındaki `mfa` ara token’ı ile çağrılır.',
  })
  @ApiOkResponse({ type: TotpSetupResponseDto })
  async setup(@Req() request: Request): Promise<TotpSetupResponseDto> {
    return this.totp.setup(await this.actorOf(request));
  }

  @Post('enable')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({
    summary: 'Kurulumu doğrula ve 2FA’yı aç',
    description: 'Yedek kodlar YALNIZ burada, bir kez döner.',
  })
  @ApiOkResponse({ type: BackupCodesResponseDto })
  async enable(
    @Req() request: Request,
    @Body() body: TotpCodeDto,
  ): Promise<BackupCodesResponseDto> {
    return this.totp.enable(await this.actorOf(request), body.code);
  }

  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Girişin ikinci adımı: TOTP veya yedek kod',
    description: '`mfa` ara token’ı + kod → tam yetkili oturum.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  verify(@Body() body: VerifyMfaDto, @Req() request: Request): Promise<LoginResponseDto> {
    return this.totp.verifyChallenge(
      body.challengeToken,
      body.code,
      requestMeta(request, body.deviceLabel),
    );
  }

  @Post('backup-codes')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yedek kodları yenile (eskiler geçersizleşir)' })
  @ApiOkResponse({ type: BackupCodesResponseDto })
  regenerate(@CurrentUser() principal: Principal): Promise<BackupCodesResponseDto> {
    return this.totp.regenerateBackupCodes(principal.userId);
  }

  @Delete()
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'İki adımlı doğrulamayı kapat',
    description: 'Geçerli bir kod istenir: ele geçirilmiş oturum 2FA’yı tek istekte sökemesin.',
  })
  async disable(@CurrentUser() principal: Principal, @Body() body: TotpCodeDto): Promise<void> {
    await this.totp.disable(principal.userId, principal.email, body.code);
  }
}
