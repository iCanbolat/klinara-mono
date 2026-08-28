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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { NotificationChannel } from '../../database/schema';
import type { Principal } from '../identity/principal';
import { OptOutsService } from './opt-outs.service';
import { CreateOptOutDto, OptOutResponseDto } from './dto/notification.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearerAuth')
@Controller('customers/:id/opt-out')
export class OptOutsController {
  constructor(private readonly optOuts: OptOutsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @ApiOperation({ summary: 'Müşterinin aktif ileti reddi kayıtları' })
  @ApiOkResponse({ type: [OptOutResponseDto] })
  list(@Param('id', new ParseUUIDPipe()) id: string): Promise<OptOutResponseDto[]> {
    return this.optOuts.list(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.NOTIFICATION_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Müşteriyi pazarlama iletilerinden çıkar',
    description:
      'İŞLEMSEL iletiler (randevu hatırlatma, iptal) bu kayıttan etkilenmez — ticari ileti değildirler.',
  })
  @ApiCreatedResponse({ type: OptOutResponseDto })
  create(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateOptOutDto,
  ): Promise<OptOutResponseDto> {
    return this.optOuts.create(principal, id, body);
  }

  @Delete()
  @RequirePermission(PERMISSIONS.NOTIFICATION_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'İleti reddini geri al (kayıt silinmez, iz kalır)' })
  @ApiNoContentResponse()
  revoke(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('channel') channel?: NotificationChannel,
  ): Promise<void> {
    return this.optOuts.revoke(principal, id, channel);
  }
}
