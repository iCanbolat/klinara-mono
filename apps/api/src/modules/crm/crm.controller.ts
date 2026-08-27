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
import { CrmService } from './crm.service';
import {
  CreateCustomerDto,
  CustomerListResponseDto,
  CustomerResponseDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

@ApiTags('customers')
@ApiBearerAuth('bearerAuth')
@Controller()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('customers')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Müşteri listesi' })
  @ApiOkResponse({ type: CustomerListResponseDto })
  async list(): Promise<CustomerListResponseDto> {
    return { data: await this.crm.listCustomers() };
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
}
