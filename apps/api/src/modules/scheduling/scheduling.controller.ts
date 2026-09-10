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
  Put,
  Query,
  Post,
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
import {
  RequireBranchScope,
  RequirePermission,
} from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { SchedulingService } from './scheduling.service';
import {
  BranchHoursResponseDto,
  HolidayInputDto,
  HolidayListResponseDto,
  HolidayResponseDto,
  ListHolidaysQueryDto,
  ListScheduleExceptionsQueryDto,
  PutBranchHoursDto,
  PutStaffScheduleDto,
  ScheduleExceptionInputDto,
  ScheduleExceptionListResponseDto,
  ScheduleExceptionResponseDto,
  StaffScheduleByBranchResponseDto,
  UpdateHolidayDto,
} from './dto/scheduling.dto';

@ApiTags('scheduling')
@ApiBearerAuth('bearerAuth')
@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('branches/:id/hours')
  @RequirePermission(PERMISSIONS.SCHEDULE_READ)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Şube çalışma saatleri' })
  @ApiOkResponse({ type: BranchHoursResponseDto })
  getBranchHours(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BranchHoursResponseDto> {
    return this.scheduling.getBranchHours(principal, id);
  }

  @Put('branches/:id/hours')
  @RequirePermission(PERMISSIONS.SCHEDULE_WRITE)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Şube çalışma saatlerini değiştir' })
  @ApiOkResponse({ type: BranchHoursResponseDto })
  replaceBranchHours(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PutBranchHoursDto,
  ): Promise<BranchHoursResponseDto> {
    return this.scheduling.replaceBranchHours(principal, id, body);
  }

  @Get('staff/:id/schedule')
  @RequirePermission(PERMISSIONS.SCHEDULE_READ)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Personelin bir şubedeki haftalık şablonu' })
  @ApiOkResponse({ type: StaffScheduleByBranchResponseDto })
  getStaffSchedule(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<StaffScheduleByBranchResponseDto> {
    return this.scheduling.getStaffSchedule(principal, id, branchId);
  }

  @Put('staff/:id/schedule')
  @RequirePermission(PERMISSIONS.SCHEDULE_WRITE)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Personelin haftalık çalışma şablonunu değiştir' })
  @ApiOkResponse({ type: StaffScheduleByBranchResponseDto })
  replaceStaffSchedule(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PutStaffScheduleDto,
  ): Promise<StaffScheduleByBranchResponseDto> {
    return this.scheduling.replaceStaffSchedule(principal, id, body);
  }

  @Get('schedule-exceptions')
  @RequirePermission(PERMISSIONS.SCHEDULE_READ)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Personel istisna kayıtları' })
  @ApiOkResponse({ type: ScheduleExceptionListResponseDto })
  async listExceptions(
    @CurrentUser() principal: Principal,
    @Query() query: ListScheduleExceptionsQueryDto,
  ): Promise<ScheduleExceptionListResponseDto> {
    return { data: await this.scheduling.listScheduleExceptions(principal, query) };
  }

  @Post('schedule-exceptions')
  @RequirePermission(PERMISSIONS.SCHEDULE_WRITE)
  @RequireBranchScope()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Personel istisna kaydı oluştur' })
  @ApiCreatedResponse({ type: ScheduleExceptionResponseDto })
  createException(
    @CurrentUser() principal: Principal,
    @Body() body: ScheduleExceptionInputDto,
  ): Promise<ScheduleExceptionResponseDto> {
    return this.scheduling.createScheduleException(principal, body);
  }

  @Delete('schedule-exceptions/:id')
  @RequirePermission(PERMISSIONS.SCHEDULE_WRITE)
  @RequireBranchScope()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Personel istisna kaydını pasife al' })
  @ApiNoContentResponse()
  async deleteException(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.scheduling.deleteScheduleException(principal, id);
  }

  // ---------------------------------------------------------------------------
  // Tatiller
  // ---------------------------------------------------------------------------
  //
  // `@RequireBranchScope()` bilerek YOK: tatil kiracı geneli de olabilir ve
  // `X-Branch-Id` zorunluluğu, "tüm şubeler" kaydını okumak için anlamsız bir
  // şube seçmeye zorlardı. Kapsam denetimi servistedir (`assertHolidayScope`)
  // ve kiracı geneli yazımı `tenantWide` role bağlar.

  @Get('holidays')
  @RequirePermission(PERMISSIONS.SCHEDULE_READ)
  @ApiOperation({
    summary: 'Tatil ve özel gün kayıtları',
    description:
      '`branchId` verilirse o şubenin kayıtlarıyla BİRLİKTE kiracı geneli kayıtlar döner — takvimi etkileyen kümenin tamamı budur.',
  })
  @ApiOkResponse({ type: HolidayListResponseDto })
  async listHolidays(
    @CurrentUser() principal: Principal,
    @Query() query: ListHolidaysQueryDto,
  ): Promise<HolidayListResponseDto> {
    return { data: await this.scheduling.listHolidays(principal, query) };
  }

  @Post('holidays')
  @RequirePermission(PERMISSIONS.SCHEDULE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tatil kaydı oluştur',
    description:
      '`branchId` verilmezse kiracı geneli olur ve tüm şubelerin takvimini etkiler; bu yüzden kiracı kapsamlı bir rol gerektirir.',
  })
  @ApiCreatedResponse({ type: HolidayResponseDto })
  createHoliday(
    @CurrentUser() principal: Principal,
    @Body() body: HolidayInputDto,
  ): Promise<HolidayResponseDto> {
    return this.scheduling.createHoliday(principal, body);
  }

  @Patch('holidays/:id')
  @RequirePermission(PERMISSIONS.SCHEDULE_WRITE)
  @ApiOperation({
    summary: 'Tatil kaydını güncelle',
    description: 'Tarih ve şube DEĞİŞTİRİLEMEZ — başka bir gün, başka bir kayıttır.',
  })
  @ApiOkResponse({ type: HolidayResponseDto })
  updateHoliday(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateHolidayDto,
  ): Promise<HolidayResponseDto> {
    return this.scheduling.updateHoliday(principal, id, body);
  }

  @Delete('holidays/:id')
  @RequirePermission(PERMISSIONS.SCHEDULE_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Tatil kaydını kaldır (soft delete)' })
  @ApiNoContentResponse()
  async deleteHoliday(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.scheduling.deleteHoliday(principal, id);
  }
}
