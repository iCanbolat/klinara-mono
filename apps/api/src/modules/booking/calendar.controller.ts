import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import {
  RequireAnyPermission,
  RequireBranchScope,
} from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { CalendarService } from './calendar.service';
import {
  AppointmentPageDto,
  CalendarDayQueryDto,
  CalendarResponseDto,
  CalendarStaffQueryDto,
  CalendarWeekQueryDto,
  ListAppointmentsQueryDto,
} from './dto/calendar.dto';

@ApiTags('calendar')
@ApiBearerAuth('bearerAuth')
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar/day')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Gün takvimi (şube saat diliminde)' })
  @ApiOkResponse({ type: CalendarResponseDto })
  day(
    @CurrentUser() principal: Principal,
    @Query() query: CalendarDayQueryDto,
  ): Promise<CalendarResponseDto> {
    return this.calendar.day(principal, query);
  }

  @Get('calendar/week')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Hafta takvimi' })
  @ApiOkResponse({ type: CalendarResponseDto })
  week(
    @CurrentUser() principal: Principal,
    @Query() query: CalendarWeekQueryDto,
  ): Promise<CalendarResponseDto> {
    return this.calendar.week(principal, query);
  }

  @Get('calendar/staff')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Tek personelin takvimi' })
  @ApiOkResponse({ type: CalendarResponseDto })
  staff(
    @CurrentUser() principal: Principal,
    @Query() query: CalendarStaffQueryDto,
  ): Promise<CalendarResponseDto> {
    return this.calendar.staff(principal, query);
  }

  @Get('appointments')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @ApiOperation({ summary: 'Filtreli randevu listesi (cursor sayfalamalı)' })
  @ApiOkResponse({ type: AppointmentPageDto })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListAppointmentsQueryDto,
  ): Promise<AppointmentPageDto> {
    return this.calendar.list(principal, query);
  }
}
