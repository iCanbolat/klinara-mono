'use client';

import { use, type ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { useBranch } from '@/components/session/branch-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { SigningFlow } from '@/components/consent/signing-flow';

/** Randevusuz KVKK imzası — işlem onamı randevuya bağlı olduğu için burada yok. */
export default function Page({ params }: { params: Promise<{ customerId: string }> }): ReactNode {
  const { customerId } = use(params);
  const { branchId } = useBranch();

  return (
    <PermissionGate required={[PERMISSIONS.CONSENT_COLLECT]}>
      <SigningFlow
        requirementsPath={`customers/${customerId}/consent-requirements`}
        signPath={`customers/${customerId}/consent-signatures`}
        returnHref={`/musteriler/${customerId}`}
        returnLabel={t('consent.sign.backToCustomer')}
        branchId={branchId}
      />
    </PermissionGate>
  );
}
