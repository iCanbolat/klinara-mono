import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { contextOf } from '../request-context';
import { PrincipalService } from '../../modules/identity/principal.service';
import { BranchAccessService } from '../../modules/tenancy/branch-access.service';
import { EDGE_ONLY_KEY, PLATFORM_ADMIN_KEY, PUBLIC_KEY } from '../decorators/auth.decorators';

/**
 * Kimlik guard'ı — global.
 *
 * Varsayılan KAPALIDIR: bir uç açıkça `@Public()` işaretlenmedikçe kimlik
 * ister. Yeni bir controller eklerken "yetki kontrolünü koymayı unutmak"
 * mümkün değil; unutulan şey ucun erişilemez olmasına yol açar, tersine değil.
 *
 * Guard'lar pipe'lardan ÖNCE koşar: kimliği doğrulanmamış bir çağıran, gövde
 * doğrulama hatalarından şemayı keşfedemez.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly principals: PrincipalService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) === true) return true;
    // Platform uçlarının kimliği JWT değil, platform token'ıdır; onu
    // `PlatformAdminGuard` doğrular.
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets) === true) {
      return true;
    }
    // Kenar proxy'sinin kimliğini `EdgeAuthGuard` doğrular; JWT beklenmez.
    if (this.reflector.getAllAndOverride<boolean>(EDGE_ONLY_KEY, targets) === true) return true;

    const request = context.switchToHttp().getRequest<Request>();

    // Middleware token'ı çözemediyse hatayı BURADA fırlatıyoruz: public uçlar
    // geçersiz bir Authorization başlığından etkilenmemeli.
    if (request.authError !== undefined) throw request.authError;

    const ctx = contextOf(request);
    if (ctx?.userId == null || ctx.tenantId == null || ctx.sessionId == null) {
      throw AppError.unauthenticated();
    }

    const principal = await this.principals.resolve({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      tokenVersion: request.tokenVersion ?? 0,
    });
    request.principal = principal;

    // `X-Branch-Id` gönderildiyse üyelik VE şubenin bu kiracıya ait olduğu
    // aranır — ucun şube kapsamı isteyip istemediğinden bağımsız olarak. Aksi
    // hâlde başlık, RLS'e yazılan bir şube context'ini keyfî olarak
    // belirleyebilirdi.
    if (ctx.branchId !== null) {
      await this.branchAccess.assertInput(principal, ctx.branchId);
    }

    return true;
  }
}
