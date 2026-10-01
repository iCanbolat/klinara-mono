'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { TemplatesPage } from '@/components/templates/templates-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.NOTIFICATION_READ]}>
      <TemplatesPage />
    </PermissionGate>
  );
}
