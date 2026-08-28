import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequireAnyPermission, RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { RemindersService } from './reminders.service';
import {
  BranchReminderSettingsDto,
  ScheduledNotificationDto,
  UpdateBranchReminderSettingsDto,
} from './dto/reminder.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearerAuth')
@Controller()
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('branches/:id/reminder-settings')
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @ApiOperation({
    summary: 'Şube hatırlatma ayarları',
    description: 'Şube kendi saatlerini tanımlamadıysa kiracı ayarı döner (`isBranchOverride`).',
  })
  @ApiOkResponse({ type: BranchReminderSettingsDto })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) branchId: string,
  ): Promise<BranchReminderSettingsDto> {
    return this.reminders.getBranchSettings(principal, branchId);
  }

  @Put('branches/:id/reminder-settings')
  @RequirePermission(PERMISSIONS.NOTIFICATION_MANAGE)
  @ApiOperation({ summary: 'Şube hatırlatma ayarlarını yaz' })
  @ApiOkResponse({ type: BranchReminderSettingsDto })
  update(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) branchId: string,
    @Body() body: UpdateBranchReminderSettingsDto,
  ): Promise<BranchReminderSettingsDto> {
    return this.reminders.updateBranchSettings(principal, branchId, body);
  }

  @Get('appointments/:id/notifications')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @ApiOperation({
    summary: 'Randevunun bildirim planı',
    description: 'İptal edilmiş ve ertelenmiş satırlar da döner — "neden gitmedi?" cevabı orada.',
  })
  @ApiOkResponse({ type: [ScheduledNotificationDto] })
  forAppointment(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<ScheduledNotificationDto[]> {
    return this.reminders.listForAppointment(principal, appointmentId);
  }
}
