'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { WorkingHoursPage } from '@/components/schedule/working-hours-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.SCHEDULE_READ]}>
      <WorkingHoursPage />
    </PermissionGate>
  );
}
