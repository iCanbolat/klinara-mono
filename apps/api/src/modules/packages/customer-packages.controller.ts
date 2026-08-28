import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@klinara/shared';
import {
  RequireBranchScope,
  RequirePermission,
} from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { weakETag } from '../../common/http/etag';
import type { Principal } from '../identity/principal';
import { CustomerPackagesService } from './customer-packages.service';
import {
  CreateCustomerPackageDto,
  CustomerPackagePageDto,
  CustomerPackageResponseDto,
  ListCustomerPackagesQueryDto,
  ListLedgerQueryDto,
  PackageLedgerPageDto,
} from './dto/customer-package.dto';

@ApiTags('packages')
@ApiBearerAuth('bearerAuth')
@Controller()
export class CustomerPackagesController {
  constructor(
    private readonly packages: CustomerPackagesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('customer-packages')
  @RequirePermission(PERMISSIONS.PACKAGE_WRITE)
  @RequireBranchScope()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Paket sat',
    description:
      'Satış anında tanımın SNAPSHOTu alınır; tanım sonradan değişse bile bu paket etkilenmez.',
  })
  @ApiHeader({ name: 'X-Branch-Id', required: true })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Aynı anahtarla tekrarlanan istek tek satış üretir.',
  })
  @ApiCreatedResponse({ type: CustomerPackageResponseDto })
  async sell(
    @CurrentUser() principal: Principal,
    @Headers('x-branch-id') branchId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateCustomerPackageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerPackageResponseDto> {
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.CREATED,
      body: await this.packages.sell(principal, branchId, body),
    }));

    response.setHeader('ETag', weakETag(result.body.version));
    return result.body;
  }

  @Get('customers/:id/packages')
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({ summary: 'Müşterinin paketleri (kalemler gömülü)' })
  @ApiOkResponse({ type: CustomerPackagePageDto })
  listForCustomer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListCustomerPackagesQueryDto,
  ): Promise<CustomerPackagePageDto> {
    return this.packages.listForCustomer(id, query);
  }

  @Get('customer-packages/:id')
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({ summary: 'Müşteri paketi detayı' })
  @ApiOkResponse({ type: CustomerPackageResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerPackageResponseDto> {
    const pkg = await this.packages.get(id);
    response.setHeader('ETag', weakETag(pkg.version));
    return pkg;
  }

  @Get('customer-packages/:id/ledger')
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({
    summary: 'Paket defteri (yeniden eskiye)',
    description: 'Append-only. Kalan hak bu satırların toplamıdır.',
  })
  @ApiOkResponse({ type: PackageLedgerPageDto })
  listLedger(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListLedgerQueryDto,
  ): Promise<PackageLedgerPageDto> {
    return this.packages.listLedger(id, query);
  }
}
