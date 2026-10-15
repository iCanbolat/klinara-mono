import { Injectable } from '@nestjs/common';
import { DEFAULT_PLAN_KEY, effectivePlanLimits, isPlanKey } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import { InvitationsService } from '../identity/invitations.service';
import * as invitationsRepo from '../identity/invitations.repository';
import { PrincipalService } from '../identity/principal.service';
import { countPlanUsage } from './plan-limits';
import { getSetupStatus } from './setup-status';
import * as repo from './tenancy.repository';
import { toBranchResponse } from './tenancy.service';
import type {
  PlatformOwnerInvitationStatusDto,
  PlatformTenantDetailDto,
  PlatformTenantDto,
  UpdatePlatformTenantDto,
} from './dto/tenant.dto';

function invitationState(row: invitationsRepo.InvitationRow): PlatformOwnerInvitationStatusDto {
  const state =
    row.acceptedAt !== null
      ? 'accepted'
      : row.revokedAt !== null
        ? 'revoked'
        : row.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : 'pending';
  return {
    email: row.email,
    state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Platform yöneticisi ekranının servisi (elden kurulum).
 *
 * Kiracı listesi `runAsPlatform` ile okunur (`tenants` politikası platform
 * bayrağını tanır). Kiracı başına sayımlar ve davet durumu ise o kiracının
 * context'inde (`runForTenant`) okunur: iş tablolarının politikalarında
 * platform istisnası YOK ve olmamalı. Okunan yalnız sayılar ve kurulum
 * bayraklarıdır, müşteri/randevu verisi değil.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly invitations: InvitationsService,
    private readonly principals: PrincipalService,
  ) {}

  async list(): Promise<PlatformTenantDto[]> {
    const tenants = await this.tx.runAsPlatform((tx) => repo.listAllTenants(tx));
    const result: PlatformTenantDto[] = [];
    // Sıralı: kiracı sayısı küçük (elden kurulum) ve her biri ayrı transaction.
    for (const tenant of tenants) result.push(await this.summarize(tenant));
    return result;
  }

  async get(id: string): Promise<PlatformTenantDetailDto> {
    const tenant = await this.findTenant(id);
    const summary = await this.summarize(tenant);
    const { branches, setup } = await this.tx.runForTenant(id, async (tx) => ({
      branches: await repo.listBranches(tx),
      setup: await getSetupStatus(tx, id),
    }));
    return { ...summary, branches: branches.map(toBranchResponse), setup };
  }

  async update(id: string, input: UpdatePlatformTenantDto): Promise<PlatformTenantDetailDto> {
    const row = await this.tx.runAsPlatform((tx) =>
      repo.updateTenantPlan(tx, id, {
        planKey: input.planKey,
        status: input.status,
        maxBranchesOverride: input.maxBranchesOverride,
        maxPractitionersOverride: input.maxPractitionersOverride,
        planNote: input.planNote,
      }),
    );
    if (row === undefined) throw AppError.notFound('Kiracı bulunamadı');
    // Askıya alma hemen etkili olsun: yetki cache'i kiracı durumunu da taşıyor.
    if (input.status !== undefined) this.principals.invalidateAll();
    return this.get(id);
  }

  resendOwnerInvitation(id: string, email?: string) {
    return this.findTenant(id).then(() => this.invitations.reissueOwnerInvitation(id, email));
  }

  private async findTenant(id: string): Promise<repo.TenantRow> {
    const tenant = await this.tx.runAsPlatform((tx) => repo.findTenantById(tx, id));
    if (tenant === undefined) throw AppError.notFound('Kiracı bulunamadı');
    return tenant;
  }

  private async summarize(tenant: repo.TenantRow): Promise<PlatformTenantDto> {
    const { usage, invitation } = await this.tx.runForTenant(tenant.id, async (tx) => ({
      usage: await countPlanUsage(tx, tenant.id),
      invitation: await invitationsRepo.findLatestOwnerInvitation(tx, tenant.id),
    }));
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      planKey: isPlanKey(tenant.planKey) ? tenant.planKey : DEFAULT_PLAN_KEY,
      maxBranchesOverride: tenant.maxBranchesOverride,
      maxPractitionersOverride: tenant.maxPractitionersOverride,
      planNote: tenant.planNote,
      limits: effectivePlanLimits(tenant),
      usage,
      ownerInvitation: invitation === undefined ? null : invitationState(invitation),
      createdAt: tenant.createdAt.toISOString(),
    };
  }
}
