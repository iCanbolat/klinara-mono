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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  BranchListResponseDto,
  BranchResponseDto,
  CreateBranchDto,
  TenantResponseDto,
  TenantSettingsResponseDto,
  UpdateBranchDto,
  UpdateTenantDto,
} from './dto/tenant.dto';
import { TenancyService } from './tenancy.service';

@ApiTags('tenancy')
@ApiBearerAuth('bearerAuth')
@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('tenant')
  @ApiOperation({ summary: 'Geçerli kiracının bilgileri' })
  @ApiOkResponse({ type: TenantResponseDto })
  getTenant(): Promise<TenantResponseDto> {
    return this.tenancy.getTenant();
  }

  @Patch('tenant')
  @ApiOperation({ summary: 'Kiracı bilgilerini güncelle' })
  @ApiOkResponse({ type: TenantResponseDto })
  updateTenant(@Body() body: UpdateTenantDto): Promise<TenantResponseDto> {
    return this.tenancy.updateTenant(body);
  }

  @Get('tenant/settings')
  @ApiOperation({ summary: 'Kiracı ayarları' })
  @ApiOkResponse({ type: TenantSettingsResponseDto })
  getSettings(): Promise<TenantSettingsResponseDto> {
    return this.tenancy.getSettings();
  }

  @Get('branches')
  @ApiOperation({ summary: 'Kiracının şubeleri' })
  @ApiOkResponse({ type: BranchListResponseDto })
  async listBranches(): Promise<BranchListResponseDto> {
    return { data: await this.tenancy.listBranches() };
  }

  @Post('branches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Yeni şube aç' })
  @ApiCreatedResponse({ type: BranchResponseDto })
  createBranch(@Body() body: CreateBranchDto): Promise<BranchResponseDto> {
    return this.tenancy.createBranch(body);
  }

  @Patch('branches/:id')
  @ApiOperation({ summary: 'Şube güncelle' })
  @ApiOkResponse({ type: BranchResponseDto })
  updateBranch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateBranchDto,
  ): Promise<BranchResponseDto> {
    return this.tenancy.updateBranch(id, body);
  }
}
