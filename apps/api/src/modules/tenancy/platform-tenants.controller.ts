import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminOnly } from '../../common/decorators/auth.decorators';
import { CreateTenantDto, CreateTenantResponseDto } from './dto/tenant.dto';
import { TenancyService } from './tenancy.service';

@ApiTags('tenancy')
@ApiBearerAuth('bearerAuth')
@Controller('platform/tenants')
// Platform yönetimi kiracı-üstü bir işlemdir: kiracı JWT'siyle değil, ayrı bir
// kanalla (PLATFORM_ADMIN_TOKEN) doğrulanır. Guard'lar pipe'lardan ÖNCE koşar,
// dolayısıyla yetkisiz çağıran doğrulama hatalarından şemayı keşfedemez.
@PlatformAdminOnly()
export class PlatformTenantsController {
  constructor(private readonly tenancy: TenancyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Yeni kiracı (klinik) oluştur',
    description:
      'Yalnız platform yöneticisi. Kiracı ile birlikte ilk şubesi ve işletme sahibi daveti oluşturulur.',
  })
  @ApiCreatedResponse({ type: CreateTenantResponseDto })
  create(@Body() body: CreateTenantDto): Promise<CreateTenantResponseDto> {
    return this.tenancy.createTenant(body);
  }
}
