import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CreateTenantDto, CreateTenantResponseDto } from './dto/tenant.dto';
import { TenancyService } from './tenancy.service';

@ApiTags('tenancy')
@ApiBearerAuth('bearerAuth')
@Controller('platform/tenants')
// Guard'lar pipe'lardan ÖNCE koşar: yetkisiz çağıran, doğrulama hatalarından
// şemayı keşfedemez (403 gövde doğrulanmadan döner).
@UseGuards(PlatformAdminGuard)
export class PlatformTenantsController {
  constructor(private readonly tenancy: TenancyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Yeni kiracı (klinik) oluştur',
    description: 'Yalnız platform yöneticisi. Kiracı ile birlikte ilk şubesi de açılır.',
  })
  @ApiCreatedResponse({ type: CreateTenantResponseDto })
  create(@Body() body: CreateTenantDto): Promise<CreateTenantResponseDto> {
    return this.tenancy.createTenant(body);
  }
}
