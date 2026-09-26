'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { WhatsAppPage } from '@/components/whatsapp/whatsapp-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.NOTIFICATION_MANAGE]}>
      <WhatsAppPage />
    </PermissionGate>
  );
}
