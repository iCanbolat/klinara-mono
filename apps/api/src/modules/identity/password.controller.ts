import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public, SelfService } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PasswordFlowService } from './password-flow.service';
import type { Principal } from './principal';
import { requestMeta } from './request-meta';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import { AuthTokensDto } from './dto/auth-response.dto';

@ApiTags('auth')
@Controller('auth/password')
export class PasswordController {
  constructor(private readonly passwords: PasswordFlowService) {}

  @Post('forgot')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Parola sıfırlama bağlantısı iste',
    description:
      'Var olmayan e-posta için de AYNI yanıt döner — bu uç kayıtlı e-postaları sızdırmaz.',
  })
  async forgot(
    @Body() body: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<{ status: string; token?: string }> {
    const result = await this.passwords.forgot(body.email, requestMeta(request));
    return { status: 'accepted', ...result };
  }

  @Post('reset')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Token ile yeni parola belirle',
    description: 'Token tek kullanımlıktır; işlem sonunda tüm oturumlar düşer.',
  })
  async reset(@Body() body: ResetPasswordDto): Promise<void> {
    await this.passwords.reset(body.token, body.newPassword);
  }

  @Post('change')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Parola değiştir',
    description:
      'Mevcut parola sorulur. Tüm oturumlar düşer ve çağırana yeni bir oturumun token’ları döner.',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  change(
    @CurrentUser() principal: Principal,
    @Body() body: ChangePasswordDto,
    @Req() request: Request,
  ): Promise<AuthTokensDto> {
    return this.passwords.change(
      principal.userId,
      body.currentPassword,
      body.newPassword,
      requestMeta(request),
    );
  }
}
