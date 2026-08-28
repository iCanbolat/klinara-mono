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
import { CashSessionsService } from './cash-sessions.service';
import { RefundsService } from './refunds.service';
import {
  CashSessionPageDto,
  CashSessionResponseDto,
  CashSessionSummaryDto,
  CloseCashSessionDto,
  CreateRefundDto,
  ListCashSessionsQueryDto,
  OpenCashSessionDto,
  RefundResponseDto,
} from './dto/cash.dto';

@ApiTags('finance')
@ApiBearerAuth('bearerAuth')
@Controller()
export class CashController {
  constructor(
    private readonly sessions: CashSessionsService,
    private readonly refunds: RefundsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('cash-sessions/open')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @RequireBranchScope()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Kasa aç',
    description: 'Şube başına yalnız bir açık oturum olabilir.',
  })
  @ApiHeader({ name: 'X-Branch-Id', required: true })
  @ApiCreatedResponse({ type: CashSessionResponseDto })
  async open(
    @CurrentUser() principal: Principal,
    @Headers('x-branch-id') branchId: string,
    @Body() body: OpenCashSessionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CashSessionResponseDto> {
    const session = await this.sessions.open(principal, branchId, body);
    response.setHeader('ETag', weakETag(session.version));
    return session;
  }

  @Post('cash-sessions/:id/close')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kasa kapat',
    description: 'Beklenen tutar hareketlerden hesaplanır; fark varsa gerekçe zorunlu.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: CashSessionResponseDto })
  async close(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: CloseCashSessionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CashSessionResponseDto> {
    const session = await this.sessions.close(principal, id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(session.version));
    return session;
  }

  @Get('cash-sessions')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_READ)
  @ApiOperation({ summary: 'Kasa oturumları (yeniden eskiye)' })
  @ApiOkResponse({ type: CashSessionPageDto })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListCashSessionsQueryDto,
  ): Promise<CashSessionPageDto> {
    return this.sessions.list(principal, query);
  }

  @Get('cash-sessions/:id/summary')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_READ)
  @ApiOperation({ summary: 'Gün sonu özeti: yöntem kırılımı ve hareket dökümü' })
  @ApiOkResponse({ type: CashSessionSummaryDto })
  summary(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CashSessionSummaryDto> {
    return this.sessions.summary(principal, id);
  }

  @Post('refunds')
  @RequirePermission(PERMISSIONS.FINANCE_PAYMENT_WRITE)
  @RequireBranchScope()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'İade yap',
    description:
      'Paket iadesi ayrıca `package:refund` ister ve paketin mutabakat ' +
      'durumunu `settled`e çeker.',
  })
  @ApiHeader({ name: 'X-Branch-Id', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: RefundResponseDto })
  async refund(
    @CurrentUser() principal: Principal,
    @Headers('x-branch-id') branchId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateRefundDto,
  ): Promise<RefundResponseDto> {
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.CREATED,
      body: await this.refunds.create(principal, branchId, body),
    }));
    return result.body;
  }
}
