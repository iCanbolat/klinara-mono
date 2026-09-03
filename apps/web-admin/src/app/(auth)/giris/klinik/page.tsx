import type { ReactNode } from 'react';
import { TenantPicker } from '@/components/auth/tenant-picker';

export const dynamic = 'force-dynamic';

export default function TenantPage(): ReactNode {
  return <TenantPicker />;
}
