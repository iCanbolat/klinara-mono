'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { useSession } from '@/components/session/session-provider';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';

export default function AccountPage(): ReactNode {
  const { me } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      /**
       * ⚠️ Sunucu parola değişiminde TÜM oturumları düşürüp YENİ token'lar
       * dönüyor. Bu yanıt genel proxy'den geçtiği için token'lar cookie'ye
       * YAZILAMIYOR — yani bu istekten sonra elimizdeki erişim token'ı ölü.
       * Doğru davranış kullanıcıyı temiz bir girişe göndermek; sessizce devam
       * etmek onu bir sonraki tıklamada anlamsız bir hataya sokardı.
       */
      await api.post('auth/password/change', { currentPassword: current, newPassword: next });
      await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.href = '/giris';
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? describeProblem(caught.problem, caught.retryAfterSeconds).message
          : networkError().message,
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">{t('account.title')}</h1>

      <Card>
        <CardTitle>{me?.user.fullName ?? ''}</CardTitle>
        <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
          <dt className="text-ink-soft">E-posta</dt>
          <dd>{me?.user.email ?? ''}</dd>
          <dt className="text-ink-soft">Roller</dt>
          <dd>{me?.roles.join(', ') ?? ''}</dd>
        </dl>
      </Card>

      <Card>
        <CardTitle>{t('account.changePassword')}</CardTitle>
        <form onSubmit={(event) => void changePassword(event)} className="flex flex-col gap-3">
          <Field
            label={t('account.currentPassword')}
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            required
          />
          <Field
            label={t('account.newPassword')}
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={10}
            hint="En az 10 karakter. Değiştirdiğinizde tüm cihazlarda oturum kapanır."
            required
          />
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" loading={busy} className="self-start">
            {t('account.changePassword')}
          </Button>
        </form>
      </Card>

      <Link href="/hesap/guvenlik" className="text-sm underline">
        {t('account.security')} →
      </Link>
    </div>
  );
}
