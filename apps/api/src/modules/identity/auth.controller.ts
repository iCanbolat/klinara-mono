import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public, SelfService } from '../../common/decorators/auth.decorators';
import { AuthService } from './auth.service';
import type { Principal } from './principal';
import { requestMeta } from './request-meta';
import { LoginDto, RefreshDto, SelectTenantDto } from './dto/auth.dto';
import { AuthTokensDto, LoginResponseDto, SessionListResponseDto } from './dto/auth-response.dto';

/** Giriş uçları için sıkı hız sınırı — kaba kuvvet denemesinin ilk bariyeri. */
const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({
    summary: 'E-posta veya telefon ile giriş',
    description:
      'İkisinden tam olarak biri gönderilir. Telefonla giriş için numaranın DOĞRULANMIŞ olması gerekir. ' +
      'Yanıt üç durumdan biridir: authenticated, tenant_selection_required, mfa_required.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() body: LoginDto, @Req() request: Request): Promise<LoginResponseDto> {
    return this.auth.login(body, requestMeta(request, body.deviceLabel));
  }

  @Post('tenant')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Birden çok klinikte çalışan kullanıcı için kiracı seçimi' })
  @ApiOkResponse({ type: LoginResponseDto })
  selectTenant(@Body() body: SelectTenantDto, @Req() request: Request): Promise<LoginResponseDto> {
    return this.auth.selectTenant(body.challengeToken, body.tenantId, requestMeta(request));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Access token yenileme',
    description:
      'Her yenileme yeni bir refresh token üretir ve eskisini yakar. Yanmış token tekrar gelirse ' +
      'oturum ailesinin tamamı iptal edilir.',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  refresh(@Body() body: RefreshDto, @Req() request: Request): Promise<AuthTokensDto> {
    return this.auth.refresh(body.refreshToken, requestMeta(request));
  }

  @Post('logout')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bu oturumu kapat' })
  @ApiNoContentResponse()
  async logout(@CurrentUser() principal: Principal): Promise<void> {
    await this.auth.logout(principal.sessionId);
  }

  @Post('logout-all')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tüm oturumları kapat',
    description:
      'Oturumları iptal etmenin yanında token sürümünü de artırır; elde kalan access token’lar da geçersizleşir.',
  })
  logoutAll(@CurrentUser() principal: Principal): Promise<{ revokedSessions: number }> {
    return this.auth.logoutAll(principal.userId);
  }

  @Get('sessions')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Aktif oturumlar' })
  @ApiOkResponse({ type: SessionListResponseDto })
  async listSessions(@CurrentUser() principal: Principal): Promise<SessionListResponseDto> {
    return { data: await this.auth.listSessions(principal.userId, principal.sessionId) };
  }

  @Delete('sessions/:id')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Tek oturumu sonlandır' })
  @ApiNoContentResponse()
  async revokeSession(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.auth.revokeSession(principal.userId, id);
  }
}
