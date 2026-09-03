'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { DomainsPage } from '@/components/domains/domains-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.BOOKING_PAGE_READ]}>
      <DomainsPage />
    </PermissionGate>
  );
}
