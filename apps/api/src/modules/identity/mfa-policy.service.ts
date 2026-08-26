import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ROLES } from '@klinara/shared';
import { tenantSettings } from '../../database/schema';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as credentialsRepo from './credentials.repository';
import * as identityRepo from './identity.repository';

/** Kiracı ayarı `require_mfa_for_admins` bu rolleri kapsar. */
const ADMIN_ROLES = new Set<string>([ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT]);

export interface MfaRequirement {
  required: boolean;
  /** Kullanıcı TOTP'yi kurmuş ve doğrulamış mı. */
  configured: boolean;
  methods: string[];
}

/**
 * "Bu kullanıcıdan ikinci faktör istenmeli mi?" sorusunun tek cevap yeri.
 *
 * İki sebeple istenir:
 *   1. Kullanıcı TOTP'yi KENDİSİ açmıştır (opsiyonel 2FA'nın normal hâli),
 *   2. Kiracı, yönetici rolleri için zorunlu kılmıştır.
 *
 * İkinci durumda kullanıcı henüz TOTP kurmamış olabilir; o zaman `configured`
 * false döner ve istemci kurulum akışına yönlendirilir. Zorunluluk ne olursa
 * olsun doğrulanmadan TAM YETKİLİ token verilmez.
 */
@Injectable()
export class MfaPolicyService {
  constructor(private readonly tx: TenantTxService) {}

  async evaluate(userId: string, tenantId: string): Promise<MfaRequirement> {
    const secret = await this.tx.runAsAuth((tx) => credentialsRepo.findTotpSecret(tx, userId));
    const configured = secret?.confirmedAt != null;

    if (configured) {
      const backupCodes = await this.tx.runAsAuth((tx) =>
        credentialsRepo.countUnusedBackupCodes(tx, userId),
      );
      return {
        required: true,
        configured: true,
        methods: backupCodes > 0 ? ['totp', 'backup_code'] : ['totp'],
      };
    }

    const enforced = await this.isEnforcedForUser(userId, tenantId);
    return { required: enforced, configured: false, methods: enforced ? ['totp'] : [] };
  }

  private async isEnforcedForUser(userId: string, tenantId: string): Promise<boolean> {
    return this.tx.runForTenant(tenantId, async (tx) => {
      const [settings] = await tx
        .select({ require: tenantSettings.requireMfaForAdmins })
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tenantId))
        .limit(1);
      if (settings?.require !== true) return false;

      const rows = await identityRepo.listMembershipsInTenant(tx, userId, tenantId);
      return rows.some((row) => ADMIN_ROLES.has(row.roleKey));
    });
  }
}
