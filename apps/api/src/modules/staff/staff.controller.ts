import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { StaffService } from './staff.service';
import {
  CreateStaffProfileDto,
  ReplaceStaffServicesDto,
  StaffListResponseDto,
  StaffProfileResponseDto,
  UpdateStaffProfileDto,
} from './dto/staff.dto';

@ApiTags('staff')
@ApiBearerAuth('bearerAuth')
@Controller()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('staff')
  @RequirePermission(PERMISSIONS.STAFF_READ)
  @ApiOperation({ summary: 'Personel listesi' })
  @ApiOkResponse({ type: StaffListResponseDto })
  async list(): Promise<StaffListResponseDto> {
    return { data: await this.staff.listStaffProfiles() };
  }

  @Post('staff')
  @RequirePermission(PERMISSIONS.STAFF_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Personel profili oluştur' })
  @ApiCreatedResponse({ type: StaffProfileResponseDto })
  create(@Body() body: CreateStaffProfileDto): Promise<StaffProfileResponseDto> {
    return this.staff.createStaffProfile(body);
  }

  @Get('staff/:id')
  @RequirePermission(PERMISSIONS.STAFF_READ)
  @ApiOperation({ summary: 'Personel profili detay' })
  @ApiOkResponse({ type: StaffProfileResponseDto })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<StaffProfileResponseDto> {
    return this.staff.getStaffProfile(id);
  }

  @Patch('staff/:id')
  @RequirePermission(PERMISSIONS.STAFF_WRITE)
  @ApiOperation({ summary: 'Personel profili güncelle' })
  @ApiOkResponse({ type: StaffProfileResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateStaffProfileDto,
  ): Promise<StaffProfileResponseDto> {
    return this.staff.updateStaffProfile(id, body);
  }

  @Put('staff/:id/services')
  @RequirePermission(PERMISSIONS.STAFF_WRITE)
  @ApiOperation({ summary: 'Personelin hizmet yetkinliklerini değiştir' })
  @ApiOkResponse({ type: StaffProfileResponseDto })
  replaceServices(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ReplaceStaffServicesDto,
  ): Promise<StaffProfileResponseDto> {
    return this.staff.replaceStaffServices(id, body);
  }
}
