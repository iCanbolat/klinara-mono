import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { BookingPageService } from './booking-page.service';
import { BookingPageDto, UpdateBookingPageDto } from './dto/booking-page.dto';
import {
  BookingPageContentDto,
  RevisionSummaryDto,
  UpdateBookingPageContentDto,
} from './dto/content.dto';

@ApiTags('booking-page')
@ApiBearerAuth('bearerAuth')
@Controller('booking-page')
export class BookingPageController {
  constructor(private readonly page: BookingPageService) {}

  @Get()
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_READ)
  @ApiOperation({
    summary: 'Randevu sayfası ayarları',
    description:
      'Sayfa kaydı yoksa ilk çağrıda açılır (platform subdomain’i ile birlikte). `usesTenantDefaults` yürürlükteki değerlerin kiracı ayarından geldiğini söyler.',
  })
  @ApiOkResponse({ type: BookingPageDto })
  get(): Promise<BookingPageDto> {
    return this.page.getPage();
  }

  @Put()
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @ApiOperation({
    summary: 'Sayfa ayarlarını yaz',
    description: '`null` gönderilen override alanı kiracı ayarına döner; hiç gönderilmeyen alan korunur.',
  })
  @ApiOkResponse({ type: BookingPageDto })
  update(@Body() body: UpdateBookingPageDto): Promise<BookingPageDto> {
    return this.page.updatePage(body);
  }

  @Get('content')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_READ)
  @ApiOperation({
    summary: 'Sayfa içeriği (taslak)',
    description: 'Taslak yoksa yayınlanmış sürüm döner — editör boş sayfayla açılmasın.',
  })
  @ApiOkResponse({ type: BookingPageContentDto })
  getContent(): Promise<BookingPageContentDto> {
    return this.page.getContent();
  }

  @Put('content')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @ApiOperation({
    summary: 'Taslak içerik kaydet',
    description:
      'Her kaydetme YENİ ve değişmez bir sürüm yazar; üzerine yazılmaz. Sözlükte olmayan blok türü reddedilir.',
  })
  @ApiOkResponse({ type: BookingPageContentDto })
  saveContent(@Body() body: UpdateBookingPageContentDto): Promise<BookingPageContentDto> {
    return this.page.saveDraft(body);
  }

  @Get('content/revisions')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_READ)
  @ApiOperation({ summary: 'İçerik sürüm geçmişi' })
  @ApiOkResponse({ type: [RevisionSummaryDto] })
  revisions(): Promise<RevisionSummaryDto[]> {
    return this.page.listRevisions();
  }

  @Post('content/rollback/:revisionId')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Eski bir sürüme dön',
    description: 'Sayfa yayındaysa yayın da o sürüme taşınır; içerik kopyalanmaz, pointer taşınır.',
  })
  @ApiOkResponse({ type: BookingPageContentDto })
  rollback(
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
  ): Promise<BookingPageContentDto> {
    return this.page.rollback(revisionId);
  }

  @Post('publish')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sayfayı yayınla',
    description: 'Yayın taslak sürüme işaret etmektir. İçeriği olmayan sayfa yayınlanamaz.',
  })
  @ApiOkResponse({ type: BookingPageDto })
  publish(): Promise<BookingPageDto> {
    return this.page.publish();
  }

  @Post('unpublish')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Yayından kaldır',
    description: 'Yayınlanmış sürüm KORUNUR; yeniden yayınlamak aynı sürüme dönmektir.',
  })
  @ApiOkResponse({ type: BookingPageDto })
  unpublish(): Promise<BookingPageDto> {
    return this.page.unpublish();
  }
}
