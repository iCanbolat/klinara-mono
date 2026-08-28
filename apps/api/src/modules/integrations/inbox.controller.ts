import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { InboxService } from './inbox.service';
import { InboxItemDto, ListInboxQueryDto } from './dto/webhook.dto';

@ApiTags('integrations')
@ApiBearerAuth('bearerAuth')
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @ApiOperation({
    summary: 'Gelen kutusu — müşterilerin serbest metin mesajları',
    description: 'Buton yanıtları buraya DÜŞMEZ; onlar randevu durumuna işlenir.',
  })
  @ApiOkResponse({ type: [InboxItemDto] })
  list(@Query() query: ListInboxQueryDto): Promise<InboxItemDto[]> {
    return this.inbox.list(query);
  }

  @Post(':id/handle')
  @RequirePermission(PERMISSIONS.NOTIFICATION_SEND)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mesajı işlendi olarak işaretle' })
  @ApiNoContentResponse()
  handle(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.inbox.markHandled(principal, id);
  }
}
