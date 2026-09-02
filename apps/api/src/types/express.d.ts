import type { RequestContext } from '../common/request-context';
import type { Principal } from '../modules/identity/principal';
import type { AppError } from '../common/errors/app-error';
import type { PublicSiteContext } from '../modules/public/public-site-resolver.service';

declare global {
  namespace Express {
    interface Request {
      /**
       * İsteğin kiracı/kullanıcı/şube bağlamı.
       *
       * NOT: `req.id` alanını pino-http tanımlar (`ReqId`); onu burada yeniden
       * bildirmiyoruz, `requestIdOf()` ile string'e çeviriyoruz.
       */
      ctx?: RequestContext;

      /**
       * Çözümlenmiş yetkiler — `AuthGuard` yazar.
       *
       * İzinler token'da TAŞINMAZ: rol değişiminin anında etkili olması için
       * her istekte üyelikten çözülür (kısa ömürlü cache ile).
       */
      principal?: Principal;

      /** Access token'daki `tv` claim'i — yetki çözümlemesinde karşılaştırılır. */
      tokenVersion?: number;

      /**
       * Token doğrulama hatası. Middleware token'ı çözemezse isteği hemen
       * düşürmez — public uçlar geçersiz bir başlıktan etkilenmemeli. Hatayı
       * `AuthGuard` fırlatır.
       */
      authError?: AppError;

      /**
       * Çözümlenmiş randevu sayfası — `PublicSiteGuard` yazar.
       *
       * Yalnız public uçlarda dolu. Kiracı kimliği ayrıca istek bağlamına da
       * yazılır (`adoptPublicTenant`); buradaki nesne controller'ın site ve
       * varsayılan şube kimliğine ulaşması için.
       */
      publicSite?: PublicSiteContext;
    }
  }
}

export {};
