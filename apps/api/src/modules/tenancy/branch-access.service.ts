import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import { canAccessBranch } from '../identity/principal';
import type { Principal } from '../identity/principal';
import * as repo from './tenancy.repository';

/**
 * Şube listesi nadiren değişir ve yazımda açıkça invalide edilir; TTL yalnızca
 * invalidasyonun kaçtığı bir yol kalırsa devreye giren güvenlik ağıdır.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Şube erişiminin TEK sahibi.
 *
 * İki ayrı soru var ve karıştırılmamaları gerekiyor:
 *
 * 1. **Üyelik** — kullanıcının bu şubede rolü var mı? (`canAccessBranch`)
 * 2. **Aidiyet** — bu şube gerçekten bu kiracının mı?
 *
 * Faz 3'e kadar yalnız (1) sorulyordu; kiracı geneli roller (owner/accountant)
 * `tenantWide` oldukları için YABANCI bir şube kimliğini de geçiriyordu. Sızıntı
 * yoktu (okuma RLS yüzünden boş küme, yazım kapsam trigger'ında `409`) ama
 * çağıran anlamsız bir hata alıyordu ve kontrol her modülde ayrı ayrı
 * kopyalanmıştı.
 *
 * Ayrım kasıtlıdır:
 *
 * - `assertMembership` — şube kimliği **veritabanından okunmuş bir satırdan**
 *   geliyorsa yeterlidir: RLS o satırın kiracıya ait olduğunu zaten kanıtladı.
 *   Senkron; transaction içinden çağrılabilir.
 * - `assertInput` — şube kimliği **istemciden** geliyorsa (gövde, sorgu
 *   parametresi, başlık) kullanılır ve aidiyeti de doğrular.
 */
@Injectable()
export class BranchAccessService {
  private readonly cache = new Map<string, { ids: Set<string>; expiresAt: number }>();

  constructor(private readonly tx: TenantTxService) {}

  /** Üyelik kontrolü. Şube kimliği güvenilir bir kaynaktan geliyorsa bu yeterli. */
  static assertMembership(principal: Principal, branchId: string): void {
    if (!canAccessBranch(principal, branchId)) throw BranchAccessService.forbidden();
  }

  /** İstemciden gelen şube kimliği: üyelik + kiracıya aidiyet. */
  async assertInput(principal: Principal, branchId: string): Promise<void> {
    BranchAccessService.assertMembership(principal, branchId);
    const ids = await this.branchIds(principal.tenantId);
    // Aidiyet doğrulanamıyorsa da 403 dönüyoruz, 404 değil: "böyle bir şube
    // var ama başka kiracıya ait" bilgisini sızdırmanın bir faydası yok.
    if (!ids.has(branchId)) throw BranchAccessService.forbidden();
  }

  /** Şube yazımlarında çağrılır; aksi hâlde yeni şube TTL kadar görünmez kalır. */
  invalidateTenant(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  clear(): void {
    this.cache.clear();
  }

  private async branchIds(tenantId: string): Promise<Set<string>> {
    const entry = this.cache.get(tenantId);
    if (entry !== undefined && entry.expiresAt > Date.now()) return entry.ids;

    const rows = await this.tx.run((tx) => repo.listBranches(tx));
    const ids = new Set(rows.map((row) => row.id));
    this.cache.set(tenantId, { ids, expiresAt: Date.now() + CACHE_TTL_MS });
    return ids;
  }

  private static forbidden(): AppError {
    return new AppError(403, ERROR_CODES.BRANCH_FORBIDDEN, 'Bu şubede yetkiniz yok');
  }
}
