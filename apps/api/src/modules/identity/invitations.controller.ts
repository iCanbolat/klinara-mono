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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@klinara/shared';
import type { Request } from 'express';
import { Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvitationsService } from './invitations.service';
import type { Principal } from './principal';
import { requestMeta } from './request-meta';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationListResponseDto,
  InvitationPreviewDto,
  InvitationResponseDto,
} from './dto/invitation.dto';
import { LoginResponseDto } from './dto/auth-response.dto';

@ApiTags('identity')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermission(PERMISSIONS.USER_INVITE)
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Personel daveti gönder',
    description: 'Kimse kendinden geniş yetkili bir rolü davet edemez.',
  })
  @ApiCreatedResponse({ type: InvitationResponseDto })
  create(
    @Body() body: CreateInvitationDto,
    @CurrentUser() principal: Principal,
  ): Promise<InvitationResponseDto> {
    return this.invitations.create(body, principal);
  }

  @Get()
  @RequirePermission(PERMISSIONS.USER_INVITE)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Davet listesi' })
  @ApiOkResponse({ type: InvitationListResponseDto })
  async list(): Promise<InvitationListResponseDto> {
    return { data: await this.invitations.list() };
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.USER_INVITE)
  @ApiBearerAuth('bearerAuth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Daveti iptal et' })
  async revoke(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.invitations.revoke(id);
  }

  @Get('token/:token')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Davet önizlemesi (kimlik doğrulaması gerekmez)',
    description: 'Yalnız daveti kabul edecek kişinin göreceği kadar bilgi döner.',
  })
  @ApiOkResponse({ type: InvitationPreviewDto })
  preview(@Param('token') token: string): Promise<InvitationPreviewDto> {
    return this.invitations.preview(token);
  }

  @Post('token/:token/accept')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Daveti kabul et',
    description:
      'Yeni hesapta parola belirlenir ve oturum açılır. E-posta zaten parolası kurulu bir hesaba ' +
      'aitse parola DEĞİŞTİRİLMEZ, yalnız üyelik eklenir (hesap devralma koruması).',
  })
  accept(
    @Param('token') token: string,
    @Body() body: AcceptInvitationDto,
    @Req() request: Request,
  ): Promise<LoginResponseDto | { status: string }> {
    return this.invitations.accept(token, body, requestMeta(request));
  }
}
