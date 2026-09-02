import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { AppError } from '../../common/errors/app-error';
import { normalizeHost } from '../../common/host';
import { PublicSiteResolverService } from './public-site-resolver.service';
import { HostResolutionDto } from './dto/public-site.dto';

/**
 * Konak adı → slug. Randevu sayfasının soğuk render'da bir kez çağırdığı uç.
 *
 * Public API'nin geri kalanı `Host` OKUMAZ, path'teki slug ile adreslenir.
 * Gerekçe: yerelde wildcard DNS gerekmez ve testler üretimle birebir aynı yolu
 * çağırır; CDN cache anahtarı `Vary: Host` taşımaz; ve `X-Forwarded-Host`
 * sahteciliği kiracı seçimi zafiyeti olamaz — sahte bir konak adının
 * yapabileceği en kötü şey buradan yanlış bir slug dönmesidir ve sonraki her
 * istek yine slug kapsamlıdır.
 */
@ApiTags('public')
@Controller('public')
export class PublicResolveController {
  constructor(private readonly resolver: PublicSiteResolverService) {}

  @Get('resolve')
  @Public()
  @Header('Cache-Control', 'public, max-age=300, s-maxage=3600')
  @ApiOperation({
    summary: 'Konak adı → randevu sayfası slug’ı',
    description:
      'Yayınlanmamış site ve doğrulanmamış alan adı için `404`. Kanonik adres, kiracının birincil konak adıdır.',
  })
  async resolve(
    @Query('host') host: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<HostResolutionDto> {
    const normalized = host === undefined ? undefined : normalizeHost(host);
    if (normalized === undefined) {
      // Geçersiz konak adı da `404`: "bu host bizde kayıtlı değil" ile "bu host
      // hiç geçerli değil" arasındaki farkı söylemek, kayıtlı konak adlarını
      // ayırt etmeye yarayan bir sinyal olurdu.
      response.setHeader('Cache-Control', 'no-store');
      throw AppError.notFound('Bu adres için bir randevu sayfası yok');
    }

    const resolved = await this.resolver.resolveHost(normalized);
    if (resolved === undefined) {
      // Negatif yanıt CACHE'LENMEZ: alan adı doğrulaması dakikalar içinde
      // tamamlanabilir ve bir saatlik negatif cache, klinik DNS'i doğru
      // kurduktan sonra bile sayfasını göremiyor demekti.
      response.setHeader('Cache-Control', 'no-store');
      throw AppError.notFound('Bu adres için bir randevu sayfası yok');
    }
    return resolved;
  }
}
