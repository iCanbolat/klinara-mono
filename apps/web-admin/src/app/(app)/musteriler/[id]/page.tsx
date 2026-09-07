'use client';

import { use, type ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { CustomerCard } from '@/components/customers/customer-card';

export default function Page({ params }: { params: Promise<{ id: string }> }): ReactNode {
  // Next 15'te `params` bir Promise; istemci bileşeninde `use()` ile çözülür.
  const { id } = use(params);

  return (
    <PermissionGate required={[PERMISSIONS.CUSTOMER_READ]}>
      <CustomerCard customerId={id} />
    </PermissionGate>
  );
}
