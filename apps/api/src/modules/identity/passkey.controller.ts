import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Request } from 'express';
import { Public, SelfService } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PasskeyService } from './passkey.service';
import type { Principal } from './principal';
import { requestMeta } from './request-meta';
import {
  PasskeyAuthOptionsDto,
  PasskeyListResponseDto,
  PasskeyResponseDto,
  RegisterPasskeyDto,
  RenamePasskeyDto,
  VerifyPasskeyDto,
} from './dto/passkey.dto';
import { LoginResponseDto } from './dto/auth-response.dto';

/**
 * Passkey yönetimi ve girişi.
 *
 * Kayıt uçları oturum ister (mobilde ilk giriş parolayla olur, sonra cihazda
 * passkey kaydedilir); giriş uçları public'tir.
 */
@ApiTags('auth')
@Controller('auth')
export class PasskeyController {
  constructor(private readonly passkeys: PasskeyService) {}

  @Post('passkeys/register/options')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Passkey kayıt seçenekleri (WebAuthn challenge)' })
  registrationOptions(@CurrentUser() principal: Principal) {
    return this.passkeys.registrationOptions(principal.userId);
  }

  @Post('passkeys/register')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cihazın ürettiği açık anahtarı kaydet' })
  register(@CurrentUser() principal: Principal, @Body() body: RegisterPasskeyDto) {
    return this.passkeys.register(
      principal.userId,
      body.response as unknown as RegistrationResponseJSON,
      body.deviceLabel ?? 'Cihaz',
    );
  }

  @Get('passkeys')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Kayıtlı passkey’ler' })
  @ApiOkResponse({ type: PasskeyListResponseDto })
  async list(@CurrentUser() principal: Principal): Promise<PasskeyListResponseDto> {
    return { data: await this.passkeys.list(principal.userId) };
  }

  @Patch('passkeys/:id')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Cihaz adını değiştir' })
  @ApiOkResponse({ type: PasskeyResponseDto })
  rename(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RenamePasskeyDto,
  ): Promise<PasskeyResponseDto> {
    return this.passkeys.rename(principal.userId, id, body.deviceLabel);
  }

  @Delete('passkeys/:id')
  @SelfService()
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Passkey sil',
    description: 'Son passkey silinirken parolanın kurulu olduğu doğrulanır.',
  })
  async remove(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.passkeys.remove(principal.userId, id);
  }

  @Post('passkey/options')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Passkey giriş seçenekleri',
    description:
      'Tanımlayıcı verilmezse discoverable credential akışı çalışır (kullanıcı adı yazmadan giriş).',
  })
  options(@Body() body: PasskeyAuthOptionsDto) {
    return this.passkeys.authenticationOptions(body);
  }

  @Post('passkey/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Passkey ile giriş',
    description: 'Tek adımdır: cihaza sahip olmak + biyometri zaten iki faktördür.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  verify(@Body() body: VerifyPasskeyDto, @Req() request: Request): Promise<LoginResponseDto> {
    return this.passkeys.verifyAuthentication(
      body.response as unknown as AuthenticationResponseJSON,
      requestMeta(request, body.deviceLabel),
    );
  }
}
