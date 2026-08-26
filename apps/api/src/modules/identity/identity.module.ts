import { Module } from '@nestjs/common';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { PasswordService } from '../../common/crypto/password.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MfaPolicyService } from './mfa-policy.service';
import { PasskeyController } from './passkey.controller';
import { PasskeyService } from './passkey.service';
import { PasswordController } from './password.controller';
import { PasswordFlowService } from './password-flow.service';
import { PhoneController } from './phone.controller';
import { PhoneService } from './phone.service';
import { PrincipalService } from './principal.service';
import { TokenService } from './token.service';
import { TotpController } from './totp.controller';
import { TotpService } from './totp.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Kimlik modülü — Faz 1'in tamamı.
 *
 * `TokenService` ve `PrincipalService` DIŞARI AÇILIR: ilkini istek context'i
 * middleware'i (token çözümlemesi), ikincisini `AuthGuard` (yetki çözümlemesi)
 * kullanır. Modülün geri kalanı kendi içinde kalır.
 */
@Module({
  controllers: [
    AuthController,
    PasswordController,
    TotpController,
    PhoneController,
    PasskeyController,
    UsersController,
    InvitationsController,
  ],
  providers: [
    PasswordService,
    FieldEncryptionService,
    TokenService,
    PrincipalService,
    MfaPolicyService,
    AuthService,
    UsersService,
    InvitationsService,
    PasswordFlowService,
    TotpService,
    PhoneService,
    PasskeyService,
  ],
  exports: [TokenService, PrincipalService, PasswordService, AuthService, InvitationsService],
})
export class IdentityModule {}
