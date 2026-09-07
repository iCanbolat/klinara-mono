'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { CatalogPage } from '@/components/catalog/catalog-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.SERVICE_READ]}>
      <CatalogPage />
    </PermissionGate>
  );
}
