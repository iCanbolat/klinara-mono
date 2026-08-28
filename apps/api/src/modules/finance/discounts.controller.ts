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
import { DiscountsService } from './discounts.service';
import {
  CreateDiscountDto,
  DiscountPageDto,
  DiscountResponseDto,
  ListDiscountsQueryDto,
  UpdateDiscountDto,
} from './dto/discount.dto';

@ApiTags('finance')
@ApiBearerAuth('bearerAuth')
@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Post()
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'İndirim/kampanya tanımı oluştur' })
  @ApiCreatedResponse({ type: DiscountResponseDto })
  async create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateDiscountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountResponseDto> {
    const discount = await this.discounts.create(principal, body);
    response.setHeader('ETag', weakETag(discount.version));
    return discount;
  }

  @Get()
  @RequirePermission(PERMISSIONS.SERVICE_READ)
  @ApiOperation({ summary: 'İndirim tanımları' })
  @ApiOkResponse({ type: DiscountPageDto })
  list(@Query() query: ListDiscountsQueryDto): Promise<DiscountPageDto> {
    return this.discounts.list(query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.SERVICE_READ)
  @ApiOperation({ summary: 'İndirim tanımı detayı' })
  @ApiOkResponse({ type: DiscountResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountResponseDto> {
    const discount = await this.discounts.get(id);
    response.setHeader('ETag', weakETag(discount.version));
    return discount;
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @ApiOperation({ summary: 'İndirim tanımını güncelle' })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: DiscountResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateDiscountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DiscountResponseDto> {
    const discount = await this.discounts.update(id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(discount.version));
    return discount;
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.SERVICE_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'İndirim tanımını pasife al',
    description: 'Kullanılmış tanım silinmez; `charges` satırları ona referans verir.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiNoContentResponse()
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<void> {
    return this.discounts.remove(id, requireIfMatch(ifMatch));
  }
}
