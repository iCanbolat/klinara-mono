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
  Post,
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
import { CatalogService } from './catalog.service';
import {
  CreateServiceCategoryDto,
  CreateServiceDto,
  ServiceCategoryListResponseDto,
  ServiceCategoryResponseDto,
  ServiceListResponseDto,
  ServiceResponseDto,
  UpdateServiceCategoryDto,
  UpdateServiceDto,
} from './dto/catalog.dto';

@ApiTags('catalog')
@ApiBearerAuth('bearerAuth')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('service-categories')
  @RequirePermission(PERMISSIONS.SERVICE_READ)
  @ApiOperation({ summary: 'Hizmet kategorileri' })
  @ApiOkResponse({ type: ServiceCategoryListResponseDto })
  async listCategories(): Promise<ServiceCategoryListResponseDto> {
    return { data: await this.catalog.listServiceCategories() };
  }

  @Post('service-categories')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Hizmet kategorisi oluştur' })
  @ApiCreatedResponse({ type: ServiceCategoryResponseDto })
  createCategory(@Body() body: CreateServiceCategoryDto): Promise<ServiceCategoryResponseDto> {
    return this.catalog.createServiceCategory(body);
  }

  @Patch('service-categories/:id')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @ApiOperation({ summary: 'Hizmet kategorisi güncelle' })
  @ApiOkResponse({ type: ServiceCategoryResponseDto })
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateServiceCategoryDto,
  ): Promise<ServiceCategoryResponseDto> {
    return this.catalog.updateServiceCategory(id, body);
  }

  @Delete('service-categories/:id')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @ApiOperation({ summary: 'Hizmet kategorisini pasife al' })
  @ApiOkResponse({ type: ServiceCategoryResponseDto })
  deactivateCategory(@Param('id', new ParseUUIDPipe()) id: string): Promise<ServiceCategoryResponseDto> {
    return this.catalog.deactivateServiceCategory(id);
  }

  @Get('services')
  @RequirePermission(PERMISSIONS.SERVICE_READ)
  @ApiOperation({ summary: 'Hizmetler' })
  @ApiOkResponse({ type: ServiceListResponseDto })
  async listServices(): Promise<ServiceListResponseDto> {
    return { data: await this.catalog.listServices() };
  }

  @Post('services')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Hizmet oluştur' })
  @ApiCreatedResponse({ type: ServiceResponseDto })
  createService(@Body() body: CreateServiceDto): Promise<ServiceResponseDto> {
    return this.catalog.createService(body);
  }

  @Get('services/:id')
  @RequirePermission(PERMISSIONS.SERVICE_READ)
  @ApiOperation({ summary: 'Hizmet detay' })
  @ApiOkResponse({ type: ServiceResponseDto })
  getService(@Param('id', new ParseUUIDPipe()) id: string): Promise<ServiceResponseDto> {
    return this.catalog.getService(id);
  }

  @Patch('services/:id')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @ApiOperation({ summary: 'Hizmet güncelle' })
  @ApiOkResponse({ type: ServiceResponseDto })
  updateService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateServiceDto,
  ): Promise<ServiceResponseDto> {
    return this.catalog.updateService(id, body);
  }

  @Delete('services/:id')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @ApiOperation({ summary: 'Hizmeti pasife al' })
  @ApiOkResponse({ type: ServiceResponseDto })
  deactivateService(@Param('id', new ParseUUIDPipe()) id: string): Promise<ServiceResponseDto> {
    return this.catalog.deactivateService(id);
  }
}
