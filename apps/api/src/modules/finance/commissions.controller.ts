import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireIfMatch, weakETag } from '../../common/http/etag';
import type { Principal } from '../identity/principal';
import { CommissionsService } from './commissions.service';
import {
  CommissionAccrualPageDto,
  CommissionPeriodResponseDto,
  CommissionReportDto,
  CommissionReportQueryDto,
  CommissionRulePageDto,
  CommissionRuleResponseDto,
  CreateCommissionRuleDto,
  ListAccrualsQueryDto,
  ListCommissionRulesQueryDto,
  ListPeriodsQueryDto,
  UpdateCommissionRuleDto,
} from './dto/commission.dto';

@ApiTags('finance')
@ApiBearerAuth('bearerAuth')
@Controller()
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Post('commission-rules')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Prim kuralı oluştur',
    description:
      'Aynı kapsam + personel + öncelik ile ikinci bir aktif kural olamaz — ' +
      'kural çözümü belirsiz olamaz.',
  })
  @ApiCreatedResponse({ type: CommissionRuleResponseDto })
  async createRule(
    @CurrentUser() principal: Principal,
    @Body() body: CreateCommissionRuleDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CommissionRuleResponseDto> {
    const rule = await this.commissions.createRule(principal, body);
    response.setHeader('ETag', weakETag(rule.version));
    return rule;
  }

  @Get('commission-rules')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_READ)
  @ApiOperation({ summary: 'Prim kuralları' })
  @ApiOkResponse({ type: CommissionRulePageDto })
  listRules(@Query() query: ListCommissionRulesQueryDto): Promise<CommissionRulePageDto> {
    return this.commissions.listRules(query);
  }

  @Patch('commission-rules/:id')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_WRITE)
  @ApiOperation({ summary: 'Prim kuralını güncelle' })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: CommissionRuleResponseDto })
  async updateRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateCommissionRuleDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CommissionRuleResponseDto> {
    const rule = await this.commissions.updateRule(id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(rule.version));
    return rule;
  }

  @Delete('commission-rules/:id')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Prim kuralını pasife al',
    description: 'Tahakkuklar kurala referans verir; kayıt silinmez.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiNoContentResponse()
  removeRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<void> {
    return this.commissions.removeRule(id, requireIfMatch(ifMatch));
  }

  @Get('commissions/accruals')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_READ)
  @ApiOperation({
    summary: 'Prim tahakkukları',
    description: 'Append-only. Ters kayıtlar negatif tutarla görünür.',
  })
  @ApiOkResponse({ type: CommissionAccrualPageDto })
  listAccruals(@Query() query: ListAccrualsQueryDto): Promise<CommissionAccrualPageDto> {
    return this.commissions.listAccruals(query);
  }

  @Get('commission-periods')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_READ)
  @ApiOperation({ summary: 'Prim dönemleri' })
  @ApiOkResponse({ type: [CommissionPeriodResponseDto] })
  listPeriods(
    @CurrentUser() principal: Principal,
    @Query() query: ListPeriodsQueryDto,
  ): Promise<CommissionPeriodResponseDto[]> {
    return this.commissions.listPeriods(principal, query);
  }

  @Post('commission-periods/:id/close')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Prim dönemini kapat',
    description: 'Kapalı döneme tahakkuk yazılamaz; düzeltmeler cari döneme düşer.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: CommissionPeriodResponseDto })
  async closePeriod(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CommissionPeriodResponseDto> {
    const period = await this.commissions.closePeriod(principal, id, requireIfMatch(ifMatch));
    response.setHeader('ETag', weakETag(period.version));
    return period;
  }

  @Get('reports/commissions')
  @RequirePermission(PERMISSIONS.FINANCE_COMMISSION_READ)
  @ApiOperation({ summary: 'Personel bazlı prim özeti (ters kayıtlar düşülmüş)' })
  @ApiOkResponse({ type: CommissionReportDto })
  report(
    @CurrentUser() principal: Principal,
    @Query() query: CommissionReportQueryDto,
  ): Promise<CommissionReportDto> {
    return this.commissions.report(principal, query);
  }
}
