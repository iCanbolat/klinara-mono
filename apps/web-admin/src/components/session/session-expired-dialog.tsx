'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { SessionStep } from '@klinara/shared';
import { ApiProblemError, sessionCall } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
    /*
      Radix `Dialog` — elle yazılmış modal DEĞİL.

      Oturum düştüğünde odak DİYALOĞUN İÇİNDE kalmalı: arkadaki sayfa artık
      yetkisiz ve kullanıcının sekme ile oraya kaçıp boş formlarla uğraşması
      anlamsız. Odak tuzağı, Escape ve gövde kaydırma kilidi Radix'ten geliyor.

      `open` sabit `true` ve kapatma yolu YOK: bu diyalog ancak yeniden giriş
      yapılınca kapanır (bileşen unmount olur). `onOpenChange` verilmediği için
      Escape ve dışarı tıklama kapatmıyor — bilinçli.
    */
    <Dialog open>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('auth.expired.title')}</DialogTitle>
          <DialogDescription>{t('auth.expired.description')}</DialogDescription>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
