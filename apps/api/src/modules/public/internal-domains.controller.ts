import { Controller, Get, Header, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { EdgeOnly } from '../../common/decorators/auth.decorators';
import { AppError } from '../../common/errors/app-error';
import { normalizeHost } from '../../common/host';
import { PublicSiteResolverService } from './public-site-resolver.service';
import { EdgeAuthorizationDto } from './dto/public-site.dto';

/**
 * Kenar proxy'sinin (Caddy on-demand TLS) sertifika öncesi sorduğu uç.
 *
 * ÜÇ KATMANLI koruma, üçü de zorunlu:
 *   1. `X-Klinara-Edge-Token` (`EdgeAuthGuard`, sabit zamanlı karşılaştırma).
 *   2. Ingress `/api/v1/internal/*`i internetten kapatır — yalnız kenar
 *      proxy'sinin özel adresi erişir (10.4 runbook maddesi).
 *   3. Hız sınırı ve numaralandırma değeri olmayan gövde: yanıt yalnız bir
 *      boolean, kiracı adı ya da slug değil.
 *
 * Yanıt SÜRESİ kritik: Caddy'nin handshake timeout'u kısa ve buradaki bir
 * yavaşlık gerçek müşteride bozuk TLS demek. Tek indeksli sorgu, `no-store`.
 *
 * ⚠️ SÖZLEŞME: Caddy `ask` ucunda **2xx = izin, 2xx dışı = ret** olarak
 * yorumlar. Gövdedeki `authorized` alanı insan içindir; kararı taşıyan şey
 * DURUM KODUDUR. Reddi `200 {"authorized": false}` ile ifade etmek, Caddy'nin
 * kendisine CNAME veren HERKESE sertifika almaya çalışması demekti — ve o yol
 * Let's Encrypt hız limitini yakarak gerçek müşterileri sertifikasız
 * bırakırdı.
 */
@ApiExcludeController()
@Controller('internal/booking-domains')
export class InternalDomainsController {
  constructor(private readonly resolver: PublicSiteResolverService) {}

  @Get('authorize')
  @EdgeOnly()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async authorize(@Query('host') host?: string): Promise<EdgeAuthorizationDto> {
    const normalized = host === undefined ? undefined : normalizeHost(host);
    const authorized =
      normalized !== undefined && (await this.resolver.authorizeEdgeHost(normalized));

    if (!authorized) {
      throw AppError.forbidden('Bu konak adı için sertifika alınamaz', {
        // Gövde kiracı adı, slug ya da "kayıtlı ama doğrulanmamış" gibi bir
        // ayrım TAŞIMAZ: iç uç bile olsa numaralandırma yüzeyi açmıyoruz.
        detail: 'Alan adı kayıtlı değil ya da DNS doğrulaması tamamlanmamış.',
      });
    }
    return { authorized: true };
  }
}
