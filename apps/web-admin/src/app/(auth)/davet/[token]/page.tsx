'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SessionStep } from '@klinara/shared';
import { ApiProblemError, noteSessionExpiry, sessionCall } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

interface Preview {
  email: string;
  fullName: string | null;
  tenantName: string;
  roleName: string;
  accountExists: boolean;
}

/**
 * Davet kabulü.
 *
 * ⚠️ İKİ SONUÇ VAR. Yeni hesapta oturum açılır; parolası ZATEN kurulu bir
 * hesaba yalnız üyelik eklenir ve oturum açılmaz. İkinci durumda kullanıcı
 * girişe yönlendirilmezse "kabul ettim ama hiçbir şey olmadı" ekranında kalır.
 * `accountExists` bayrağı, parola alanını hiç göstermemek için de kullanılıyor.
 */
export default function InvitePage(): ReactNode {
  const router = useRouter();
  const token = String(useParams().token ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/session/invitation/${encodeURIComponent(token)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setError('Davet bağlantısı geçersiz ya da süresi dolmuş.');
        return;
      }
      const data = (await response.json()) as Preview;
      setPreview(data);
      setFullName(data.fullName ?? '');
    })();
  }, [token]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const step = await sessionCall<SessionStep>(`invitation/${encodeURIComponent(token)}`, {
        ...(preview?.accountExists === true ? {} : { password }),
        ...(fullName === '' ? {} : { fullName }),
      });
      if (step.step === 'authenticated') {
        noteSessionExpiry(step.expiresIn);
        router.replace('/');
        router.refresh();
        return;
      }
      if (step.step === 'membership_added') {
        setNotice(t('auth.invite.membershipAdded'));
        return;
      }
      router.push(step.step === 'mfa' ? '/giris/dogrulama' : '/giris/klinik');
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

  if (notice !== null) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <Alert tone="ok">{notice}</Alert>
        <a href="/giris" className="mt-4 block text-center text-sm underline">
          {t('auth.login.submit')}
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h1 className="mb-1 text-lg font-semibold text-foreground">{t('auth.invite.title')}</h1>
      {preview !== null ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {preview.tenantName} · {preview.roleName} · {preview.email}
        </p>
      ) : null}

      {error !== null && preview === null ? <Alert tone="danger">{error}</Alert> : null}

      {preview !== null ? (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <Field
            label="Ad soyad"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
          />
          {preview.accountExists ? null : (
            <Field
              label={t('auth.reset.password')}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              hint="En az 10 karakter."
              required
            />
          )}
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" loading={busy}>
            {t('auth.invite.submit')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
