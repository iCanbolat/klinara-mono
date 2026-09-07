'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { StaffPage } from '@/components/staff/staff-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.STAFF_READ]}>
      <StaffPage />
    </PermissionGate>
  );
}
