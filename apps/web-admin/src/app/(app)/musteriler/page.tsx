'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { CustomersPage } from '@/components/customers/customers-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.CUSTOMER_READ]}>
      <CustomersPage />
    </PermissionGate>
  );
}
