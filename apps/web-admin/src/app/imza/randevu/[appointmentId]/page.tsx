'use client';

import { Suspense, use, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { PERMISSIONS } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { safeReturnPath } from '@/lib/consent/signing-flow';
import { useBranch } from '@/components/session/branch-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { SigningFlow } from '@/components/consent/signing-flow';

export default function Page({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}): ReactNode {
  const { appointmentId } = use(params);

  return (
    <PermissionGate required={[PERMISSIONS.CONSENT_COLLECT]}>
      {/* Dönüş adresi `?donus=` parametresinde; `useSearchParams` Suspense sınırı istiyor. */}
      <Suspense>
        <AppointmentSigning appointmentId={appointmentId} />
      </Suspense>
    </PermissionGate>
  );
}

function AppointmentSigning({ appointmentId }: { appointmentId: string }): ReactNode {
  const searchParams = useSearchParams();
  const { branchId } = useBranch();

  return (
    <SigningFlow
      requirementsPath={`appointments/${appointmentId}/consent-requirements`}
      signPath={`appointments/${appointmentId}/consent-signatures`}
      returnHref={safeReturnPath(searchParams.get('donus'), '/takvim')}
      returnLabel={t('consent.sign.back')}
      branchId={branchId}
    />
  );
}
