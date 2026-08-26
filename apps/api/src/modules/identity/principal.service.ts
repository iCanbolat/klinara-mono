import { Injectable } from '@nestjs/common';
import { ERROR_CODES, type RoleKey } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from './principal';
import * as repo from './identity.repository';

/**
 * Yetki çözümlemesinin ömrü.
 *
 * Neden cache: izinler her istekte üyelikten okunur; onsuz her istek en az bir
 * join daha yapar. Neden KISA: rol değişimi anında etkili olmalı. Açık
 * invalidasyon (üyelik/rol yazımı, parola değişimi, logout-all) asıl mekanizma;
 * TTL yalnız güvenlik ağıdır — invalidasyonun kaçtığı bir yol kalırsa
 * yetkisizlik en fazla bu kadar sürer.
 *
 * ⚠️ Süreç-içi cache tek instance varsayar. Yatay ölçeklemede (Batch 10.2)
 * invalidasyon bir kanal üzerinden yayınlanmalıdır; TTL o güne kadar üst sınırı
 * belirler.
 */
const CACHE_TTL_MS = 15_000;
const CACHE_MAX_ENTRIES = 5_000;

interface CacheEntry {
  principal: Principal;
  expiresAt: number;
}

@Injectable()
export class PrincipalService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly tx: TenantTxService) {}

  private static key(userId: string, tenantId: string, sessionId: string): string {
    return `${userId}|${tenantId}|${sessionId}`;
  }

  /**
   * Access token claim'lerinden yetkileri çözer.
   *
   * Burada üç şey birden doğrulanır ve üçü de fail-closed'dır:
   *   1. Kullanıcı yaşıyor ve aktif mi,
   *   2. Token sürümü güncel mi (`logout-all` sonrası eski token'lar düşer),
   *   3. Oturum iptal edilmemiş ve süresi dolmamış mı.
   */
  async resolve(input: {
    userId: string;
    tenantId: string;
    sessionId: string;
    tokenVersion: number;
  }): Promise<Principal> {
    const key = PrincipalService.key(input.userId, input.tenantId, input.sessionId);
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      this.assertTokenVersion(cached.principal, input.tokenVersion);
      return cached.principal;
    }

    const row = await this.tx.run(async (tx) => {
      const session = await repo.findActiveSession(tx, input.sessionId, input.userId);
      if (session === undefined) return undefined;
      return repo.resolvePrincipal(tx, input.userId, input.tenantId);
    });

    if (row === undefined || row.user === undefined) {
      // Oturum iptal edilmiş, kullanıcı silinmiş ya da bu kiracıda üyeliği yok.
      throw AppError.unauthenticated('Oturum geçerli değil', {
        detail: 'Oturum sonlandırılmış olabilir; yeniden giriş yapın.',
      });
    }
    if (!row.user.isActive) {
      throw new AppError(403, ERROR_CODES.ACCOUNT_DISABLED, 'Hesap devre dışı');
    }
    if (row.memberships.length === 0) {
      throw AppError.forbidden('Bu klinikte yetkiniz yok');
    }

    const principal: Principal = {
      userId: row.user.id,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      email: row.user.email,
      fullName: row.user.fullName,
      tokenVersion: row.user.tokenVersion,
      roles: row.memberships.map((m) => m.roleKey as RoleKey),
      permissions: new Set(row.permissions),
      branchIds: [
        ...new Set(
          row.memberships.map((m) => m.branchId).filter((id): id is string => id !== null),
        ),
      ],
      tenantWide: row.memberships.some((m) => m.branchId === null),
    };

    this.assertTokenVersion(principal, input.tokenVersion);
    this.store(key, principal);
    return principal;
  }

  private assertTokenVersion(principal: Principal, tokenVersion: number): void {
    if (principal.tokenVersion !== tokenVersion) {
      // Parola değişti veya tüm oturumlar düşürüldü: elindeki access token eski.
      throw AppError.unauthenticated('Oturum artık geçerli değil', {
        detail: 'Parola değişikliği veya güvenlik çıkışı sonrası yeniden giriş gerekir.',
      });
    }
  }

  private store(key: string, principal: Principal): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // En eski girdiyi at (Map ekleme sırasını korur) — basit LRU yerine
      // FIFO yeterli: girdiler zaten saniyeler içinde bayatlıyor.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { principal, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  /** Rol/üyelik değişiminde, parola değişiminde ve çıkışta çağrılır. */
  invalidateUser(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}|`)) this.cache.delete(key);
    }
  }

  invalidateSession(sessionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.endsWith(`|${sessionId}`)) this.cache.delete(key);
    }
  }

  /** Kiracı genelinde rol tanımı değiştiğinde. */
  invalidateAll(): void {
    this.cache.clear();
  }
}
