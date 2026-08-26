import type { Request } from 'express';
import type { RequestMeta } from './auth.service';

/**
 * İsteğin izi: IP ve tarayıcı bilgisi.
 *
 * Oturum listesinde ("bu cihaz nereden bağlandı?") ve giriş denetiminde
 * kullanılır. `trust proxy` açık olduğu için `req.ip` ters proxy arkasında da
 * gerçek istemci adresidir.
 */
export function requestMeta(request: Request, deviceLabel?: string): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : undefined,
    deviceLabel,
  };
}
