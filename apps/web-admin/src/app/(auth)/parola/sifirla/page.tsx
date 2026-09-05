'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { ApiProblemError, sessionCall } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export const dynamic = 'force-dynamic';

function ResetForm(): ReactNode {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sessionCall('password/reset', { token, newPassword: password });
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? describeProblem(caught.problem, caught.retryAfterSeconds).message
          : networkError().message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h1 className="text-title-m mb-5 text-foreground">{t('auth.reset.title')}</h1>
      {done ? (
        <>
          <Alert tone="ok">{t('auth.reset.done')}</Alert>
          <a href="/giris" className="mt-4 block text-center text-sm underline">
            {t('auth.login.submit')}
          </a>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <Field
            label={t('auth.reset.password')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={10}
            hint="En az 10 karakter."
            required
            autoFocus
          />
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" loading={busy}>
            {t('auth.reset.submit')}
          </Button>
        </form>
      )}
    </div>
  );
}

export default function ResetPage(): ReactNode {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
