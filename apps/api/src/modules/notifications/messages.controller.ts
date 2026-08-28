import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { MessagesService } from './messages.service';
import { ListMessagesQueryDto, MessagePageDto } from './dto/notification.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearerAuth')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @ApiOperation({
    summary: 'Gönderilen mesajlar (cursor sayfalamalı)',
    description: 'Alıcı adresi MASKELİ döner — ham adres veritabanında da saklanmaz.',
  })
  @ApiOkResponse({ type: MessagePageDto })
  list(@Query() query: ListMessagesQueryDto): Promise<MessagePageDto> {
    return this.messages.list(query);
  }
}
