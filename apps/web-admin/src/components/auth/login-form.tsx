'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { SessionStep } from '@klinara/shared';
import { ApiProblemError, noteSessionExpiry, sessionCall } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasskeyButton } from './passkey-button';

/**
 * E-posta + parola girişi ve üç yollu dallanma.
 *
 * `SessionStep` ayrımlı bir birleşim olduğu için dallanma derleyici tarafından
 * eksiksiz kontrol ediliyor: API'ye yeni bir durum eklenirse (ör. "parola
 * değiştirmelisiniz") burası derlenmez ve o durum sessizce yutulmaz.
 */
export function LoginForm(): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Açık yönlendirme olmasın diye YALNIZ göreli yol kabul ediliyor. */
  const next = safeNext(params.get('next'));

  function handleStep(step: SessionStep): void {
    switch (step.step) {
      case 'authenticated':
        noteSessionExpiry(step.expiresIn);
        router.replace(next);
        router.refresh();
        return;
      case 'tenant':
        router.push('/giris/klinik');
        return;
      case 'mfa':
        router.push('/giris/dogrulama');
        return;
      case 'membership_added':
        // Giriş akışında bu durum oluşmaz; yine de sessizce yutmuyoruz.
        setError(t('auth.invite.membershipAdded'));
        return;
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      handleStep(await sessionCall<SessionStep>('login', { email, password }));
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
      <h1 className="text-title-m mb-5 text-foreground">{t('auth.login.title')}</h1>

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <Field
          label={t('auth.login.email')}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
        <Field
          label={t('auth.login.password')}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" loading={busy}>
          {t('auth.login.submit')}
        </Button>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        <PasskeyButton onStep={handleStep} onError={setError} />
        <a href="/parola/unuttum" className="text-center text-sm text-muted-foreground underline">
          {t('auth.login.forgot')}
        </a>
      </div>
    </div>
  );
}

/**
 * Giriş sonrası dönülecek yol.
 *
 * Yalnız `/` ile başlayan ve `//` ile başlamayan değerler kabul ediliyor:
 * `//kotusite.com` tarayıcı tarafından protokol-göreli MUTLAK bir adres olarak
 * çözülür ve açık yönlendirme açığı olurdu.
 */
function safeNext(value: string | null): string {
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
