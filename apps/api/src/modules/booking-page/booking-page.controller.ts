import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { requireIfMatch, weakETag } from '../../common/http/etag';
import { BookingPageService } from './booking-page.service';
import { PublicSiteService, type PublicSiteView } from '../public/public-site.service';
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
  constructor(
    private readonly page: BookingPageService,
    private readonly publicSite: PublicSiteService,
  ) {}

  /**
   * Taslak önizleme — public sayfanın GÖRECEĞİ şeklin birebir aynısı.
   *
   * Yanıt tipi bilerek `GET /public/sites/:slug` ile AYNI (`PublicSiteView`):
   * editörün iframe'i web-booking'in gerçek renderer'ını çalıştırıyor ve ona
   * ikinci bir şekil vermek, "önizlemede güzeldi ama yayında bozuk" sınıfı
   * hataların kaynağı olurdu. Entegrasyon testi, yayınlanmış bir revizyonun
   * önizlemesinin public yanıtla deep-equal olduğunu iddia ediyor.
   *
   * ⚠️ `no-store` ZORUNLU: bu bir TASLAK. Bir ara cache'in ya da CDN'in bunu
   * tutması, yayınlanmamış içeriğin ziyaretçiye servis edilmesi demekti.
   * `Vary: Authorization` da aynı sebeple — yanıt kullanıcıya özel.
   */
  @Get('preview')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_READ)
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  @ApiOperation({
    summary: 'Taslak önizleme',
    description:
      'Taslak revizyonu, yayınlanmış sayfayla aynı sunum boru hattından geçirir. `revisionId` verilirse o sürüm önizlenir (sürüm geçmişi için).',
  })
  @ApiQuery({ name: 'revisionId', required: false, format: 'uuid' })
  async preview(
    @Query('revisionId', new ParseUUIDPipe({ optional: true })) revisionId?: string,
  ): Promise<PublicSiteView> {
    const page = await this.page.getPage();
    return this.publicSite.getDraftSite(page.slug, page.id, revisionId);
  }

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

  /**
   * ⚠️ `ETag` TASLAK sürüm numarasıdır, içerik hash'i değil.
   *
   * `common/http/etag.ts`teki `weakETag`/`requireIfMatch` çiftinin iyimser
   * kilit tokenı; `contentETag` ise public tarafın cache validator'ı. İkisi
   * farklı amaçta ve karıştırılmamalı. Taslağı olmayan sayfanın tokenı `W/"0"`
   * — böylece ilk kaydetmenin de gönderecek bir değeri oluyor.
   */
  @Get('content')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_READ)
  @ApiOperation({
    summary: 'Sayfa içeriği (taslak)',
    description:
      'Taslak yoksa yayınlanmış sürüm döner — editör boş sayfayla açılmasın. `ETag` taslak sürüm numarasıdır ve `PUT`ta `If-Match` olarak geri gönderilir.',
  })
  @ApiOkResponse({ type: BookingPageContentDto })
  async getContent(@Res({ passthrough: true }) response: Response): Promise<BookingPageContentDto> {
    const content = await this.page.getContent();
    response.setHeader('ETag', weakETag(content.draft?.revisionNumber ?? 0));
    return content;
  }

  @Put('content')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @ApiOperation({
    summary: 'Taslak içerik kaydet',
    description:
      'Her kaydetme YENİ ve değişmez bir sürüm yazar; üzerine yazılmaz. Sözlükte olmayan blok türü reddedilir. `If-Match` ZORUNLU: `GET /booking-page/content`ten dönen `ETag` (taslak yoksa `W/"0"`).',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: BookingPageContentDto })
  async saveContent(
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateBookingPageContentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingPageContentDto> {
    const saved = await this.page.saveDraft(body, requireIfMatch(ifMatch));
    response.setHeader('ETag', weakETag(saved.draft?.revisionNumber ?? 0));
    return saved;
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
  async rollback(
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingPageContentDto> {
    // Geri alma taslak işaretçisini taşıyor: editörün elindeki `If-Match`
    // tokenı bayatlıyor. Yeni tokenı yanıtla vermek, kullanıcıyı bir de
    // yeniden okumaya zorlamamak için.
    const content = await this.page.rollback(revisionId);
    response.setHeader('ETag', weakETag(content.draft?.revisionNumber ?? 0));
    return content;
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
