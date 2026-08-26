import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SelfService } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PhoneService } from './phone.service';
import type { Principal } from './principal';
import {
  PhoneVerificationStartedDto,
  PhoneVerifiedDto,
  StartPhoneVerificationDto,
  VerifyPhoneDto,
} from './dto/phone.dto';

/**
 * Telefon doğrulama (Netgsm SMS).
 *
 * SMS bir giriş FAKTÖRÜ değildir; yalnız numaranın kime ait olduğunu doğrular.
 * Doğrulanan numara mobilin birincil giriş TANIMLAYICISI olur, ispat ise
 * passkey veya paroladan gelir.
 */
@ApiTags('auth')
@ApiBearerAuth('bearerAuth')
@Controller('auth/phone')
export class PhoneController {
  constructor(private readonly phone: PhoneService) {}

  @Post('start')
  @SelfService()
  @HttpCode(HttpStatus.OK)
  // SMS PARALIDIR: uç seviyesinde de sınırlanır (servis ayrıca kullanıcı ve
  // numara başına hız sınırı uygular).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Numara ekle ve SMS ile doğrulama kodu gönder' })
  @ApiOkResponse({ type: PhoneVerificationStartedDto })
  start(
    @CurrentUser() principal: Principal,
    @Body() body: StartPhoneVerificationDto,
  ): Promise<PhoneVerificationStartedDto> {
    return this.phone.start(principal.userId, body.phone);
  }

  @Post('verify')
  @SelfService()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Kodu doğrula — numara giriş tanımlayıcısı olur' })
  @ApiOkResponse({ type: PhoneVerifiedDto })
  verify(
    @CurrentUser() principal: Principal,
    @Body() body: VerifyPhoneDto,
  ): Promise<PhoneVerifiedDto> {
    return this.phone.verify(principal.userId, body.code);
  }

  @Delete()
  @SelfService()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Numarayı kaldır' })
  async remove(@CurrentUser() principal: Principal): Promise<void> {
    await this.phone.remove(principal.userId);
  }
}
