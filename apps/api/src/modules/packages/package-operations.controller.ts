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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { requireIfMatch, weakETag } from '../../common/http/etag';
import type { Principal } from '../identity/principal';
import { PackageOperationsService } from './package-operations.service';
import { CustomerPackageResponseDto } from './dto/customer-package.dto';
import {
  AdjustPackageDto,
  ListEntitlementsQueryDto,
  ConsumePackageDto,
  ConsumePackageResultDto,
  PackageEntitlementDto,
  RefundPackageDto,
  RefundResultDto,
  TransferPackageDto,
} from './dto/package-operation.dto';

/**
 * NOT: `If-Match` ile `Idempotency-Key` birlikte kullanılıyor ve bu KASITLI.
 * İlki "bayat durum üzerinde işlem yaptın"ı, ikincisi "aynı isteği tekrar
 * gönderdin"i durdurur. Farklı iki hata; biri diğerinin yerini tutmaz.
 */
@ApiTags('packages')
@ApiBearerAuth('bearerAuth')
@Controller()
export class PackageOperationsController {
  constructor(
    private readonly operations: PackageOperationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('customers/:id/package-entitlements')
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({
    summary: 'Kullanılabilir paket hakları',
    description:
      'Randevu ekranının paket seçimi için: aktif, süresi dolmamış ve kalanı olan kalemler.',
  })
  @ApiOkResponse({ type: [PackageEntitlementDto] })
  entitlements(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListEntitlementsQueryDto,
  ): Promise<PackageEntitlementDto[]> {
    return this.operations.listEntitlements(id, query);
  }

  @Post('appointments/:id/consume-package')
  @RequirePermission(PERMISSIONS.PACKAGE_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Randevu kalemlerini pakete bağla (ve gerekiyorsa düş)',
    description:
      'Randevu zaten `completed` ise bağlar VE düşer; değilse yalnız bağlar — tamamlanınca kendiliğinden düşer.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOkResponse({ type: ConsumePackageResultDto })
  async consume(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ConsumePackageDto,
  ): Promise<ConsumePackageResultDto> {
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.OK,
      body: await this.operations.consumeForAppointment(principal, id, body),
    }));
    return result.body;
  }

  @Post('customer-packages/:id/adjust')
  @RequirePermission(PERMISSIONS.PACKAGE_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kalan hakkı manuel düzelt',
    description: 'Gerekçe zorunludur; düzeltme deftere `manual_adjustment` olarak iz bırakır.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiOkResponse({ type: CustomerPackageResponseDto })
  async adjust(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: AdjustPackageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerPackageResponseDto> {
    const pkg = await this.operations.adjust(principal, id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(pkg.version));
    return pkg;
  }

  @Post('customer-packages/:id/refund')
  @RequirePermission(PERMISSIONS.PACKAGE_REFUND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paketi (kısmen) iade et',
    description:
      'Tutar SATIŞ ANINDAKİ tahsisten hesaplanır. Kasa hareketi YOKTUR: yükümlülük `pending` olarak kaydedilir, tahsilat tarafı Batch 6.2de bağlanır.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOkResponse({ type: RefundResultDto })
  async refund(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: RefundPackageDto,
  ): Promise<RefundResultDto> {
    const expectedVersion = requireIfMatch(ifMatch);
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.OK,
      body: await this.operations.refund(principal, id, expectedVersion, body),
    }));
    return result.body;
  }

  @Post('customer-packages/:id/transfer')
  @RequirePermission(PERMISSIONS.PACKAGE_TRANSFER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Kalan hakkı başka müşteriye devret',
    description:
      'Hedef için YENİ bir paket açılır: aynı snapshot, aynı geçerlilik sonu. Yanıt hedef pakettir.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOkResponse({ type: CustomerPackageResponseDto })
  async transfer(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: TransferPackageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerPackageResponseDto> {
    const expectedVersion = requireIfMatch(ifMatch);
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.CREATED,
      body: await this.operations.transfer(principal, id, expectedVersion, body),
    }));
    response.setHeader('ETag', weakETag(result.body.version));
    return result.body;
  }
}
