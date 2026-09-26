import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { StaffNotificationsService } from './staff-notifications.service';
import {
  ListStaffNotificationsQueryDto,
  MarkStaffNotificationsReadDto,
  StaffNotificationFeedDto,
} from './dto/staff-notification.dto';

/** Panelin zil ikonu. Okundu bilgisi kişisel olduğu için her uç `Principal` ister. */
@ApiTags('notifications')
@ApiBearerAuth('bearerAuth')
@Controller('staff-notifications')
@RequirePermission(PERMISSIONS.NOTIFICATION_READ)
export class StaffNotificationsController {
  constructor(private readonly notifications: StaffNotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Personel bildirim akışı ve okunmamış sayısı' })
  @ApiOkResponse({ type: StaffNotificationFeedDto })
  feed(
    @CurrentUser() principal: Principal,
    @Query() query: ListStaffNotificationsQueryDto,
  ): Promise<StaffNotificationFeedDto> {
    return this.notifications.feed(principal, query);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bildirimleri okundu işaretle (`ids` boşsa tümü)' })
  @ApiNoContentResponse()
  markRead(
    @CurrentUser() principal: Principal,
    @Body() body: MarkStaffNotificationsReadDto,
  ): Promise<void> {
    return this.notifications.markRead(principal, body);
  }
}
