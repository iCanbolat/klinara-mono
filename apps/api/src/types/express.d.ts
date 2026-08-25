import type { RequestContext } from '../common/request-context';

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
    }
  }
}

export {};
