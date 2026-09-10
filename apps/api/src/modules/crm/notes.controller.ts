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
import { requireIfMatch, weakETag } from '../../common/http/etag';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { NotesService } from './notes.service';
import {
  CreateCustomerNoteDto,
  CustomerNoteListResponseDto,
  CustomerNoteResponseDto,
  CustomerNoteRevisionListDto,
  TimelinePageDto,
  TimelineQueryDto,
  UpdateCustomerNoteDto,
} from './dto/note.dto';

@ApiTags('customer-notes')
@ApiBearerAuth('bearerAuth')
@Controller()
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get('customers/:id/notes')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'Müşteri notları',
    description:
      'İşlem ve iç notlar yalnız `customer.medical:read` izni olanlara döner; diğerleri için sorgudan hiç çıkmaz.',
  })
  @ApiOkResponse({ type: CustomerNoteListResponseDto })
  async list(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerNoteListResponseDto> {
    return { data: await this.notes.list(principal, id) };
  }

  @Post('customers/:id/notes')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Müşteriye not ekle' })
  @ApiCreatedResponse({ type: CustomerNoteResponseDto })
  async create(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateCustomerNoteDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerNoteResponseDto> {
    const note = await this.notes.create(principal, id, body);
    response.setHeader('ETag', weakETag(note.version));
    return note;
  }

  @Get('customers/:id/timeline')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'Müşteri zaman çizelgesi (randevu + not, tek akış)',
    description: 'Cursor sayfalamalı; olaylar `occurredAt` azalan sırada döner.',
  })
  @ApiOkResponse({ type: TimelinePageDto })
  timeline(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TimelineQueryDto,
  ): Promise<TimelinePageDto> {
    return this.notes.timeline(principal, id, query);
  }

  @Patch('notes/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @ApiOperation({
    summary: 'Notu düzenle (eski sürüm saklanır)',
    description:
      '`If-Match` ZORUNLU: başlıksız istek `428`, bayat sürüm `409 VERSION_CONFLICT` alır. Sürümü yalnız METİN değişimi artırır.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"1"' })
  @ApiOkResponse({ type: CustomerNoteResponseDto })
  async update(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateCustomerNoteDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerNoteResponseDto> {
    const note = await this.notes.update(principal, id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(note.version));
    return note;
  }

  @Delete('notes/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Notu arşivle (soft delete)' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.notes.remove(principal, id);
  }

  @Get('notes/:id/revisions')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Notun düzenleme geçmişi' })
  @ApiOkResponse({ type: CustomerNoteRevisionListDto })
  async revisions(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerNoteRevisionListDto> {
    return { data: await this.notes.revisions(principal, id) };
  }
}
