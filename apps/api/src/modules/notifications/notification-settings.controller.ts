import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { NotificationSettingsService } from './notification-settings.service';
import {
  NotificationTemplateResponseDto,
  UpsertNotificationTemplateDto,
} from './dto/notification.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearerAuth')
@Controller()
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get('notification-templates')
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @ApiOperation({
    summary: 'Bildirim şablonları',
    description:
      'Kiracının yazdığı şablonlar ve varsayılanlar birlikte döner; `isDefault` hangisinin yürürlükte olduğunu söyler.',
  })
  @ApiOkResponse({ type: [NotificationTemplateResponseDto] })
  listTemplates(): Promise<NotificationTemplateResponseDto[]> {
    return this.settings.listTemplates();
  }

  @Put('notification-templates')
  @RequirePermission(PERMISSIONS.NOTIFICATION_MANAGE)
  @ApiOperation({ summary: 'Bildirim şablonunu yaz (olay + kanal + dil anahtarıyla)' })
  @ApiOkResponse({ type: NotificationTemplateResponseDto })
  upsertTemplate(
    @Body() body: UpsertNotificationTemplateDto,
  ): Promise<NotificationTemplateResponseDto> {
    return this.settings.upsertTemplate(body);
  }
}
