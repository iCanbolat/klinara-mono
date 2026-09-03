import type { ReactNode } from 'react';
import { MfaForm } from '@/components/auth/mfa-form';

export const dynamic = 'force-dynamic';

export default function MfaPage(): ReactNode {
  return <MfaForm />;
}
