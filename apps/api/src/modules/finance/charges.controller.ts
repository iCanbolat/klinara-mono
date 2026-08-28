import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { requireIfMatch, weakETag } from '../../common/http/etag';
import type { Principal } from '../identity/principal';
import { ChargesService } from './charges.service';
import {
  ChargePageDto,
  ChargeResponseDto,
  CreateChargeDto,
  CustomerAccountDto,
  ListAccountQueryDto,
  ListChargesQueryDto,
  UpdateChargeDto,
  VoidChargeDto,
} from './dto/charge.dto';

@ApiTags('finance')
@ApiBearerAuth('bearerAuth')
@Controller()
export class ChargesController {
  constructor(
    private readonly charges: ChargesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('charges')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @RequireBranchScope()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Elle ücret kalemi aç',
    description:
      'Yalnız ürün ve serbest kalemler. Randevu ve paket ücretleri kendi ' +
      'işlemlerinin transaction’ında otomatik doğar.',
  })
  @ApiHeader({ name: 'X-Branch-Id', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: ChargeResponseDto })
  async create(
    @CurrentUser() principal: Principal,
    @Headers('x-branch-id') branchId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateChargeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChargeResponseDto> {
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.CREATED,
      body: await this.charges.create(principal, branchId, body),
    }));

    response.setHeader('ETag', weakETag(result.body.version));
    return result.body;
  }

  @Get('charges')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_READ)
  @ApiOperation({ summary: 'Ücret kalemleri (yeniden eskiye)' })
  @ApiOkResponse({ type: ChargePageDto })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListChargesQueryDto,
  ): Promise<ChargePageDto> {
    return this.charges.list(principal, query);
  }

  @Get('charges/:id')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_READ)
  @ApiOperation({ summary: 'Ücret kalemi detayı' })
  @ApiOkResponse({ type: ChargeResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChargeResponseDto> {
    const charge = await this.charges.get(id);
    response.setHeader('ETag', weakETag(charge.version));
    return charge;
  }

  @Patch('charges/:id')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @ApiOperation({
    summary: 'Ücret kalemini düzelt',
    description: 'Liste fiyatının dışına çıkılıyorsa `finance.price:override` gerekir.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: ChargeResponseDto })
  async update(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateChargeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChargeResponseDto> {
    const charge = await this.charges.update(principal, id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(charge.version));
    return charge;
  }

  @Post('charges/:id/void')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ücret kalemini iptal et',
    description: 'Satır silinmez; `void` da bir denetim izidir.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: ChargeResponseDto })
  async void(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: VoidChargeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChargeResponseDto> {
    const charge = await this.charges.void(
      principal,
      id,
      requireIfMatch(ifMatch),
      body.reason,
    );
    response.setHeader('ETag', weakETag(charge.version));
    return charge;
  }

  @Get('customers/:id/account')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_READ)
  @ApiOperation({
    summary: 'Müşteri cari hesabı',
    description: 'Bakiye saklanmaz; borç ve tahsilat satırlarından türetilir.',
  })
  @ApiOkResponse({ type: CustomerAccountDto })
  account(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListAccountQueryDto,
  ): Promise<CustomerAccountDto> {
    return this.charges.account(principal, id, query);
  }
}
