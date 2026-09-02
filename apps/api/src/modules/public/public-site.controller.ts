import { Controller, Get, Headers, HttpStatus, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { applyCache, matchesETag, payloadETag } from '../../common/http/cache';
import { PublicThrottlerGuard } from '../../common/guards/public-throttler.guard';
import { PublicSiteGuard } from './public-site.guard';
import { PublicAvailabilityService } from './public-availability.service';
import {
  PublicAvailabilityDto,
  PublicAvailabilityQueryDto,
  PublicBranchDto,
  PublicStaffDto,
  PublicStaffQueryDto,
} from './dto/public-availability.dto';
import { PublicStaffService } from './public-staff.service';
import { PublicSiteService, type PublicSiteView } from './public-site.service';
import type { PublicCategoryView } from './present-public-site';
import type { PublicSiteContext } from './public-site-resolver.service';

/** Sayfa içeriği: tarayıcıda kısa, CDN'de beş dakika. */
const SITE_CACHE = { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 600 };
/** Katalog fiyat ve süre taşır; içerikten daha çabuk bayatlamamalı. */
const CATALOG_CACHE = { maxAge: 30, sMaxAge: 120, staleWhileRevalidate: 300 };
/**
 * Uygunluk 15 saniye cache'lenir.
 *
 * Daha kısası anlamsız (bir sayfa render'ı bile o kadar sürüyor), daha uzunu
 * satılmış slot göstermek demek. Bu uç, public yüzeyin en pahalı sorgusu:
 * CDN'in önünde durması bir optimizasyon değil, DoS koruması.
 */
const AVAILABILITY_CACHE = { maxAge: 15, sMaxAge: 15 };

/**
 * Yayınlanmış randevu sayfasının okuma yüzeyi.
 *
 * Kiracı `PublicSiteGuard` tarafından PATH'TEKİ SLUG'dan çözülür ve istek
 * bağlamına yazılır; bu noktadan sonra bütün sorgular olağan izolasyon
 * politikaları altında koşar. `app.public_flow` yalnız çözümleme anında
 * devredeydi.
 */
@ApiTags('public')
@Controller('public/sites/:slug')
@Public()
@UseGuards(PublicThrottlerGuard, PublicSiteGuard)
export class PublicSiteController {
  constructor(
    private readonly site: PublicSiteService,
    private readonly availability: PublicAvailabilityService,
    private readonly staff: PublicStaffService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Yayınlanmış randevu sayfası',
    description:
      'Tema, içerik blokları, şubeler ve randevu akışının ihtiyaç duyduğu ayarlar. `ETag` içerik hash’inden türer; `If-None-Match` ile `304` döner.',
  })
  async get(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
  ): Promise<PublicSiteView | undefined> {
    const { view, etag } = await this.site.getSite(siteOf(request));

    applyCache(response, SITE_CACHE, etag);
    if (matchesETag(ifNoneMatch, etag)) {
      // Gövde GÖNDERİLMEZ. `304`ün amacı tam olarak baytları taşımamak;
      // gövdeyle birlikte dönen bir 304 tasarrufun kendisini iptal ederdi.
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return view;
  }

  @Get('services')
  @ApiOperation({
    summary: 'Online randevuya açık hizmetler',
    description:
      'Şube override’ları uygulanmış hâlde, kategoriye göre gruplu. `showPrices` kapalıysa fiyat alanı HİÇ dönmez.',
  })
  async services(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('branchId') branchId?: string,
  ): Promise<PublicCategoryView[]> {
    const categories = await this.site.getServices(siteOf(request), branchId);
    // Katalog bir içerik SÜRÜMÜNE bağlı değil (katalog düzenlemesi sayfa
    // sürümü üretmez), bu yüzden validator gövdeden türetiliyor.
    applyCache(response, CATALOG_CACHE, payloadETag(categories));
    return categories;
  }

  @Get('branches')
  @ApiOperation({ summary: 'Randevu alınabilen şubeler' })
  async branches(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicBranchDto[]> {
    const { view } = await this.site.getSite(siteOf(request));
    applyCache(response, CATALOG_CACHE, payloadETag(view.branches));
    return view.branches;
  }

  @Get('staff')
  @ApiOperation({
    summary: 'Seçilebilir uygulayıcılar',
    description:
      'Yalnız `is_visible_online` açık ve İSTENEN HİZMETLERİN HEPSİNDE yetkin personel. ' +
      'Kimlik yerine opak ve kalıcı `staffRef` döner. `showStaffSelection` kapalıyken liste boştur.',
  })
  async staffOptions(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query() query: PublicStaffQueryDto,
  ): Promise<PublicStaffDto[]> {
    const staff = await this.staff.list(siteOf(request), query);
    applyCache(response, CATALOG_CACHE, payloadETag(staff));
    return staff;
  }

  @Get('availability')
  // Public yüzeyin en pahalı sorgusu; kendi sınırı var ve sayaç IP+slug
  // bazlı (bkz. PublicThrottlerGuard).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Uygun saatler',
    description:
      'Faz 3 motorunun public sarmalayıcısı. Yanıtta HİÇBİR UUID yoktur; slot opak `slotToken` ile temsil edilir.',
  })
  async availabilitySlots(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query() query: PublicAvailabilityQueryDto,
  ): Promise<PublicAvailabilityDto> {
    const slots = await this.availability.findSlots(siteOf(request), query);
    applyCache(response, AVAILABILITY_CACHE, payloadETag(slots));
    return slots;
  }
}

export function siteOf(request: Request): PublicSiteContext {
  const site = request.publicSite;
  // Guard olmadan bir public controller yazılırsa burada patlar. Sessizce
  // devam etmek, kiracı bağlamı olmayan bir sorgunun RLS'e takılıp boş küme
  // dönmesi ve bunun "kayıt yok" gibi görünmesi demekti.
  if (site === undefined) throw new Error('PublicSiteGuard bağlanmamış');
  return site;
}
