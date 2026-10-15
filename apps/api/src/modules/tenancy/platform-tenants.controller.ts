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
import { PlatformAdminOnly } from '../../common/decorators/auth.decorators';
import {
  CreateTenantDto,
  CreateTenantResponseDto,
  PlatformOwnerInvitationResendDto,
  PlatformTenantDetailDto,
  PlatformTenantListDto,
  TenantOwnerInvitationDto,
  UpdatePlatformTenantDto,
} from './dto/tenant.dto';
import { PlatformTenantsService } from './platform-tenants.service';
import { TenancyService } from './tenancy.service';

@ApiTags('tenancy')
@ApiBearerAuth('bearerAuth')
@Controller('platform/tenants')
// Platform yönetimi kiracı-üstü bir işlemdir: kiracı JWT'siyle değil, ayrı bir
// kanalla (PLATFORM_ADMIN_TOKEN) doğrulanır. Guard'lar pipe'lardan ÖNCE koşar,
// dolayısıyla yetkisiz çağıran doğrulama hatalarından şemayı keşfedemez.
@PlatformAdminOnly()
export class PlatformTenantsController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly platform: PlatformTenantsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Kiracı listesi (plan, kullanım, sahip daveti durumu)' })
  @ApiOkResponse({ type: PlatformTenantListDto })
  async list(): Promise<PlatformTenantListDto> {
    return { data: await this.platform.list() };
  }

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

  @Get(':id')
  @ApiOperation({ summary: 'Kiracı detayı: şubeler ve kurulum kontrol listesi' })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformTenantDetailDto> {
    return this.platform.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Plan, durum ve limit override’larını güncelle' })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlatformTenantDto,
  ): Promise<PlatformTenantDetailDto> {
    return this.platform.update(id, body);
  }

  @Post(':id/owner-invitation')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'İşletme sahibi davetini yeniden gönder',
    description: 'Bekleyen sahip davetleri iptal edilir, yenisi açılır ve e-postayla gönderilir.',
  })
  @ApiCreatedResponse({ type: TenantOwnerInvitationDto })
  resendOwnerInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PlatformOwnerInvitationResendDto,
  ): Promise<TenantOwnerInvitationDto> {
    return this.platform.resendOwnerInvitation(id, body.email);
  }
}
