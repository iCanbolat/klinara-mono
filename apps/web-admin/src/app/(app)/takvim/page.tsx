'use client';

import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { PermissionGate } from '@/components/session/permission-gate';
import { CalendarPage } from '@/components/calendar/calendar-page';

export default function Page(): ReactNode {
  return (
    // `anyOf`: uygulayıcı `appointment:read.all` TAŞIMAZ, yalnız `read.own`
    // taşır. `required` ile yazılsaydı takvimi hiç açamazdı.
    <PermissionGate
      required={[]}
      anyOf={[PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN]}
    >
      <CalendarPage />
    </PermissionGate>
  );
}
