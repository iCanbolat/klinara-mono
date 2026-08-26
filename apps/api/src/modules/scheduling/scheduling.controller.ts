import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  ListScheduleExceptionsQueryDto,
  PutBranchHoursDto,
  PutStaffScheduleDto,
  ScheduleExceptionInputDto,
  ScheduleExceptionListResponseDto,
  ScheduleExceptionResponseDto,
  StaffScheduleByBranchResponseDto,
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
}
