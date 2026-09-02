import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { PublicSiteResolverService } from './public-site-resolver.service';

/**
 * Public randevu uçlarının kiracı çözümleyicisi.
 *
 * `:slug` yol parametresinden kiracıyı bulur ve istek bağlamına yazar. Bundan
 * SONRA `TenantTxService.run()`, `IdempotencyService` ve uygunluk cache'i
 * hiçbir değişiklik olmadan çalışır — public yol iç yolun altyapısını aynen
 * kullanır, kopyasını değil.
 *
 * Guard olarak duruyor çünkü middleware DI'dan önce ve TÜM rotalarda koşar;
 * her isteğe bir veritabanı sorgusu eklemek istemiyoruz. Guard yalnız bu
 * controller'lara bağlı.
 */
@Injectable()
export class PublicSiteGuard implements CanActivate {
  constructor(private readonly resolver: PublicSiteResolverService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const slug = (request.params as Record<string, string | undefined>)['slug'];
    if (slug === undefined || slug === '') {
      throw AppError.notFound('Randevu sayfası bulunamadı');
    }

    request.publicSite = await this.resolver.adopt(slug);
    return true;
  }
}
