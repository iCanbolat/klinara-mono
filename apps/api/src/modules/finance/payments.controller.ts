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
import { requireIfMatch, weakETag } from '../../common/http/etag';
import type { Principal } from '../identity/principal';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PaymentPageDto,
  PaymentResponseDto,
  VoidPaymentDto,
} from './dto/payment.dto';

@ApiTags('finance')
@ApiBearerAuth('bearerAuth')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @RequireBranchScope()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tahsilat al',
    description:
      'Dağıtım verilmezse müşterinin açık kalemlerine eskiden yeniye ' +
      'otomatik dağıtılır; artan tutar avans olarak kalır.',
  })
  @ApiHeader({ name: 'X-Branch-Id', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  async create(
    @CurrentUser() principal: Principal,
    @Headers('x-branch-id') branchId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreatePaymentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResponseDto> {
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.CREATED,
      body: await this.payments.create(principal, branchId, body),
    }));

    response.setHeader('ETag', weakETag(result.body.version));
    return result.body;
  }

  @Get()
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_READ)
  @ApiOperation({ summary: 'Tahsilatlar (yeniden eskiye)' })
  @ApiOkResponse({ type: PaymentPageDto })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaymentPageDto> {
    return this.payments.list(principal, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_READ)
  @ApiOperation({ summary: 'Tahsilat detayı (dağıtım gömülü)' })
  @ApiOkResponse({ type: PaymentResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResponseDto> {
    const payment = await this.payments.get(id);
    response.setHeader('ETag', weakETag(payment.version));
    return payment;
  }

  @Post(':id/void')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tahsilatı iptal et',
    description: 'Tahsis satırları silinmez; bakiye filtreyle kendiliğinden geri gelir.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: PaymentResponseDto })
  async void(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: VoidPaymentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResponseDto> {
    const payment = await this.payments.void(
      principal,
      id,
      requireIfMatch(ifMatch),
      body.reason,
    );
    response.setHeader('ETag', weakETag(payment.version));
    return payment;
  }
}
