'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { SessionStep } from '@klinara/shared';
import { ApiProblemError, sessionCall } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

/**
 * Oturum bittiğinde açılan yeniden giriş modalı.
 *
 * KABUL KRİTERİ BU BİLEŞENDE: "süresi dolan oturum kullanıcıyı veri
 * kaybettirmeden girişe düşürür."
 *
 * Yönlendirme YOK: `/giris`e gitmek editördeki React ağacını unmount eder ve
 * kullanıcının yazdığı her şey — form durumu, kaydırma konumu, seçili blok —
 * kaybolur. Modal ise sayfanın üzerine biniyor, altındaki ağaç canlı kalıyor
 * ve giriş başarılı olduğunda kullanıcı tam bıraktığı yerde devam ediyor.
 *
 * TEK İSTİSNA: yanıt `tenant` ya da `mfa` ise çok adımlı akış bir modala
 * sığmaz; o durumda `/giris`e gidiliyor. Taslak kurtarma katmanı (11.5) o
 * ihtimal için içeriği `sessionStorage`a yazıyor.
 */
export function SessionExpiredDialog({
  email,
  onRecovered,
}: {
  email: string;
  onRecovered: (expiresIn: number) => void;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const step = await sessionCall<SessionStep>('login', { email, password });
      if (step.step === 'authenticated') {
        onRecovered(step.expiresIn);
        return;
      }
      // Çok adımlı akış modala sığmaz; kullanıcıyı tam sayfaya taşıyoruz.
      window.location.href = `/giris?next=${encodeURIComponent(window.location.pathname)}`;
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
    >
      <div className="w-full max-w-sm rounded-lg border border-line bg-card p-5 shadow-lg animate-rise">
        <h2 id="session-expired-title" className="text-base font-semibold text-ink">
          {t('auth.expired.title')}
        </h2>
        <p className="mt-1 mb-4 text-sm text-ink-soft">{t('auth.expired.description')}</p>

        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <Field
            label={t('auth.login.email')}
            type="email"
            value={email}
            readOnly
            autoComplete="username"
          />
          <Field
            label={t('auth.login.password')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" loading={busy}>
            {t('auth.expired.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
