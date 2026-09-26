'use client';

import { Suspense, type ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { MessagesPage } from '@/components/messages/messages-page';

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.NOTIFICATION_SEND]}>
      {/* Seçili sohbet `?c=` parametresinde; `useSearchParams` Suspense sınırı istiyor. */}
      <Suspense>
        <MessagesPage />
      </Suspense>
    </PermissionGate>
  );
}
