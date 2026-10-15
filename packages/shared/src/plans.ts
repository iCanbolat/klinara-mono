/**
 * Abonelik planları.
 *
 * ⚠️ Landing sitesindeki fiyat tablosuyla (`klinara-landing/app/config/pricing.ts`)
 * SENKRON tutulmalı: planlar yalnız kapasitede ayrışır (şube ve hekim/uygulayıcı
 * sayısı), özelliklerin hepsi her planda vardır.
 *
 * Ödeme altyapısı yok; planı platform yöneticisi elle atar. `ozel` planının
 * limitleri kiracıya özel override alanlarıyla belirlenir (verilmezse
 * Çok Şubeli limitleri geçerlidir).
 *
 * Hekim/uygulayıcı = aktif personel profili (`staff_profiles.is_active`):
 * takvimde randevu alabilen kişi. Resepsiyon ve yöneticiler sayılmaz.
 */
export const PLAN_KEYS = ['baslangic', 'klinik', 'cok-subeli', 'ozel'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** Aylık liste fiyatı (₺, KDV hariç); `ozel` için `null`. */
  monthlyPrice: number | null;
  maxBranches: number;
  maxPractitioners: number;
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
  baslangic: {
    key: 'baslangic',
    name: 'Başlangıç',
    monthlyPrice: 1490,
    maxBranches: 1,
    maxPractitioners: 2,
  },
  klinik: {
    key: 'klinik',
    name: 'Klinik',
    monthlyPrice: 2990,
    maxBranches: 1,
    maxPractitioners: 8,
  },
  'cok-subeli': {
    key: 'cok-subeli',
    name: 'Çok Şubeli',
    monthlyPrice: 6490,
    maxBranches: 3,
    maxPractitioners: 25,
  },
  ozel: { key: 'ozel', name: 'Özel', monthlyPrice: null, maxBranches: 3, maxPractitioners: 25 },
};

export const DEFAULT_PLAN_KEY: PlanKey = 'klinik';

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && (PLAN_KEYS as readonly string[]).includes(value);
}

export interface PlanLimits {
  maxBranches: number;
  maxPractitioners: number;
}

/** Plan + kiracıya özel override → geçerli limitler. Override her planda geçerlidir. */
export function effectivePlanLimits(input: {
  planKey: string;
  maxBranchesOverride?: number | null;
  maxPractitionersOverride?: number | null;
}): PlanLimits {
  const plan = PLANS[isPlanKey(input.planKey) ? input.planKey : DEFAULT_PLAN_KEY];
  return {
    maxBranches: input.maxBranchesOverride ?? plan.maxBranches,
    maxPractitioners: input.maxPractitionersOverride ?? plan.maxPractitioners,
  };
}

export interface PlanUsage {
  branches: number;
  practitioners: number;
}

/** `GET tenant/plan` — panelde "Plan ve kullanım" kartı. */
export interface TenantPlanInfo {
  planKey: PlanKey;
  planName: string;
  limits: PlanLimits;
  usage: PlanUsage;
}

/** Elden kurulum kontrol listesinin maddeleri; sıra panelde gösterim sırasıdır. */
export const SETUP_STEP_KEYS = [
  'branch',
  'hours',
  'services',
  'practitioners',
  'whatsapp',
  'bookingPage',
] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

/** `GET tenant/setup-status` — klinik kurulumu nerede kaldı. */
export interface TenantSetupStatus {
  steps: { key: SetupStepKey; done: boolean }[];
  /** Tüm maddeler tamam mı; panel kurulum kartını buna göre gizler. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Platform yöneticisi (elden kurulum) — `platform/tenants`
// ---------------------------------------------------------------------------

export type TenantStatus = 'trial' | 'active' | 'suspended';

export interface PlatformOwnerInvitationStatus {
  email: string;
  state: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
}

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  planKey: PlanKey;
  maxBranchesOverride: number | null;
  maxPractitionersOverride: number | null;
  planNote: string | null;
  limits: PlanLimits;
  usage: PlanUsage;
  ownerInvitation: PlatformOwnerInvitationStatus | null;
  createdAt: string;
}

export interface PlatformTenantDetail extends PlatformTenant {
  branches: { id: string; slug: string; name: string; isActive: boolean }[];
  setup: TenantSetupStatus;
}

export interface CreatePlatformTenantInput {
  slug: string;
  name: string;
  planKey?: PlanKey;
  maxBranchesOverride?: number;
  maxPractitionersOverride?: number;
  branch: { slug: string; name: string };
  owner: { email: string; fullName?: string };
}

export interface UpdatePlatformTenantInput {
  planKey?: PlanKey;
  status?: TenantStatus;
  maxBranchesOverride?: number | null;
  maxPractitionersOverride?: number | null;
  planNote?: string | null;
}

/** Davet oluşturma/yeniden gönderme yanıtı (sahip daveti). */
export interface PlatformOwnerInvitationResult {
  email: string;
  expiresAt: string;
  mailDelivered?: boolean;
  /** Yalnız üretim dışında. */
  token?: string;
  link?: string;
}
