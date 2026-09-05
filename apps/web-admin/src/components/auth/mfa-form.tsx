'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SessionStep } from '@klinara/shared';
import { ApiProblemError, noteSessionExpiry, sessionCall } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

/**
 * İkinci faktör adımı — hem doğrulama hem İLK KURULUM.
 *
 * `configured === false` durumu, kiracının yöneticiler için 2FA'yı zorunlu
 * kıldığı ama kullanıcının henüz kurmadığı hâl: kullanıcı giriş yapamıyor ama
 * kurulumu yapması gerekiyor. API bu yüzden `setup`/`enable` uçlarında
 * challenge token'ını Bearer olarak kabul ediyor.
 */
export function MfaForm(): ReactNode {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/session/challenge', { credentials: 'same-origin' });
      if (!response.ok) {
        router.replace('/giris');
        return;
      }
      const step = (await response.json()) as SessionStep;
      if (step.step !== 'mfa') {
        router.replace('/giris');
        return;
      }
      setConfigured(step.configured);
      if (!step.configured) {
        setSecret(await sessionCall<{ secret: string; otpauthUri: string }>('mfa/setup'));
      }
    })().catch(() => setError(networkError().message));
  }, [router]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (configured === false && backupCodes === null) {
        // Önce kurulumu tamamla; yedek kodlar YALNIZ BİR KEZ dönüyor.
        const result = await sessionCall<{ backupCodes: string[] }>('mfa/enable', { code });
        setBackupCodes(result.backupCodes);
        setCode('');
        return;
      }
      const step = await sessionCall<SessionStep>('mfa/verify', { code });
      if (step.step === 'authenticated') {
        noteSessionExpiry(step.expiresIn);
        router.replace('/');
        router.refresh();
        return;
      }
      router.replace('/giris');
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
      <h1 className="text-lg font-semibold text-foreground">
        {configured === false ? t('auth.mfa.setupTitle') : t('auth.mfa.title')}
      </h1>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        {configured === false ? t('auth.mfa.setupDescription') : t('auth.mfa.description')}
      </p>

      {secret !== null && backupCodes === null ? (
        <div className="mb-4 rounded-md bg-muted p-3">
          <p className="mb-1 text-xs text-muted-foreground">Kurulum anahtarı</p>
          <code className="block break-all text-sm">{secret.secret}</code>
        </div>
      ) : null}

      {backupCodes !== null ? (
        <Alert tone="warn" title={t('auth.mfa.backupTitle')} className="mb-4">
          <p className="mb-2">{t('auth.mfa.backupDescription')}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
            {backupCodes.map((backup) => (
              <li key={backup}>{backup}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <Field
          label={t('auth.mfa.code')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
        />
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" loading={busy}>
          {t('auth.mfa.submit')}
        </Button>
      </form>
    </div>
  );
}
