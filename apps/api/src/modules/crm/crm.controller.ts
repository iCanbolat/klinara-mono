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
  Put,
  Query,
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
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { CrmService } from './crm.service';
import {
  CreateCustomerDto,
  CustomerMergeResponseDto,
  CustomerPageDto,
  CustomerResponseDto,
  CustomerTagInputDto,
  CustomerTagListResponseDto,
  CustomerTagResponseDto,
  ListCustomersQueryDto,
  MergeCustomerDto,
  PutCustomerTagsDto,
  SearchCustomersQueryDto,
  UpdateCustomerDto,
  UpdateCustomerTagDto,
} from './dto/customer.dto';

@ApiTags('customers')
@ApiBearerAuth('bearerAuth')
@Controller()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('customers')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Müşteri listesi (cursor sayfalamalı)' })
  @ApiOkResponse({ type: CustomerPageDto })
  list(@Query() query: ListCustomersQueryDto): Promise<CustomerPageDto> {
    return this.crm.listCustomers(query);
  }

  // NOT: bu yol `customers/:id`den ÖNCE tanımlı olmalı; aksi hâlde "search"
  // bir uuid sanılır ve `ParseUUIDPipe` 400 verir.
  @Get('customers/search')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Müşteri arama (ad veya telefon, Türkçe duyarlı)' })
  @ApiOkResponse({ type: [CustomerResponseDto] })
  search(@Query() query: SearchCustomersQueryDto): Promise<CustomerResponseDto[]> {
    return this.crm.searchCustomers(query);
  }

  @Post('customers')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Müşteri kartı oluştur' })
  @ApiCreatedResponse({ type: CustomerResponseDto })
  create(@Body() body: CreateCustomerDto): Promise<CustomerResponseDto> {
    return this.crm.createCustomer(body);
  }

  @Get('customers/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Müşteri kartı detay' })
  @ApiOkResponse({ type: CustomerResponseDto })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<CustomerResponseDto> {
    return this.crm.getCustomer(id);
  }

  @Patch('customers/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @ApiOperation({ summary: 'Müşteri kartını güncelle' })
  @ApiOkResponse({ type: CustomerResponseDto })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateCustomerDto,
  ): Promise<CustomerResponseDto> {
    return this.crm.updateCustomer(id, body);
  }

  @Delete('customers/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @ApiOperation({ summary: 'Müşteri kartını arşivle (soft delete)' })
  @ApiOkResponse({ type: CustomerResponseDto })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<CustomerResponseDto> {
    return this.crm.deleteCustomer(id);
  }

  @Put('customers/:id/tags')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @ApiOperation({ summary: 'Müşterinin etiketlerini topluca ayarla' })
  @ApiOkResponse({ type: CustomerResponseDto })
  putTags(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PutCustomerTagsDto,
  ): Promise<CustomerResponseDto> {
    return this.crm.replaceCustomerTags(id, body.tagIds);
  }

  @Post('customers/:id/merge')
  @RequirePermission(PERMISSIONS.CUSTOMER_MERGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mükerrer müşteri kaydını bu karta birleştir' })
  @ApiOkResponse({ type: CustomerMergeResponseDto })
  merge(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MergeCustomerDto,
  ): Promise<CustomerMergeResponseDto> {
    return this.crm.mergeCustomer(principal, id, body.sourceCustomerId);
  }

  // ---------------------------------------------------------------------------
  // Etiketler
  // ---------------------------------------------------------------------------

  @Get('customer-tags')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Etiket listesi' })
  @ApiOkResponse({ type: CustomerTagListResponseDto })
  async listTags(): Promise<CustomerTagListResponseDto> {
    return { data: await this.crm.listTags() };
  }

  @Post('customer-tags')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Etiket oluştur' })
  @ApiCreatedResponse({ type: CustomerTagResponseDto })
  createTag(@Body() body: CustomerTagInputDto): Promise<CustomerTagResponseDto> {
    return this.crm.createTag(body);
  }

  @Patch('customer-tags/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @ApiOperation({ summary: 'Etiketi güncelle' })
  @ApiOkResponse({ type: CustomerTagResponseDto })
  updateTag(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateCustomerTagDto,
  ): Promise<CustomerTagResponseDto> {
    return this.crm.updateTag(id, body);
  }

  @Delete('customer-tags/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Etiketi sil' })
  @ApiNoContentResponse()
  deleteTag(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.crm.deleteTag(id);
  }
}
