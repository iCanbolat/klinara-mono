'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { sessionCall } from '@/lib/api/client';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

/**
 * Parola sıfırlama talebi.
 *
 * Hesabın var olup olmadığı SÖYLENMİYOR — her durumda aynı onay metni
 * gösteriliyor. "Böyle bir e-posta yok" demek bir kullanıcı numaralandırma
 * açığıdır ve sunucu da kasıtla 202 dönüyor.
 */
export default function ForgotPage(): ReactNode {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      await sessionCall('password/forgot', { email });
    } catch {
      // Hata da yutuluyor: aksi hâlde "bu adres kayıtlı" bilgisi hata/başarı
      // farkından sızardı.
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-card p-5 shadow-sm">
      <h1 className="mb-4 text-lg font-semibold text-ink">{t('auth.forgot.title')}</h1>
      {sent ? (
        <Alert tone="ok">{t('auth.forgot.sent')}</Alert>
      ) : (
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
          <Button type="submit" loading={busy}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
      <a href="/giris" className="mt-4 block text-center text-sm text-ink-soft underline">
        {t('common.back')}
      </a>
    </div>
  );
}
