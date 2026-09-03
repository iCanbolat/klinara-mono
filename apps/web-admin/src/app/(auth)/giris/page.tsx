import { Suspense, type ReactNode } from 'react';
import { LoginForm } from '@/components/auth/login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage(): ReactNode {
  // `useSearchParams` bir Suspense sınırı istiyor (`next` parametresi için).
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
