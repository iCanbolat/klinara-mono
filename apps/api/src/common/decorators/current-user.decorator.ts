import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import type { Principal } from '../../modules/identity/principal';

/**
 * Doğrulanmış kullanıcının çözümlenmiş yetkileri.
 *
 * `AuthGuard` isteğe yazar; buradan okunur. Guard koşmadan bir handler'a
 * gelinmesi mümkün değildir, yine de eksikliği sessizce geçmiyoruz.
 */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const principal = request.principal;
  if (principal === undefined) throw AppError.unauthenticated();
  return principal;
});

export type { Principal };
