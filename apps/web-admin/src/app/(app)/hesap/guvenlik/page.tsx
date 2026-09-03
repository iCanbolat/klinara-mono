'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { PasskeyInfo, SessionInfo, TotpStatus } from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';

interface Listed<T> {
  data: T[];
}

/** Batch 11.4 — 2FA, passkey ve açık oturum yönetimi. */
export default function SecurityPage(): ReactNode {
  const [totp, setTotp] = useState<TotpStatus | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [status, keys, active] = await Promise.all([
        api.get<TotpStatus>('auth/2fa'),
        api.get<Listed<PasskeyInfo>>('auth/passkeys'),
        api.get<Listed<SessionInfo>>('auth/sessions'),
      ]);
      setTotp(status);
      setPasskeys(keys.data);
      setSessions(active.data);
    } catch (caught) {
      setError(toMessage(caught));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function addPasskey(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Kayıt oturum açıkken yapılıyor ve token ÜRETMİYOR; bu yüzden özel bir
      // oturum handler'ı değil, genel proxy üzerinden gidiyor.
      const options = await api.post<Record<string, unknown>>('auth/passkeys/register/options');
      const attestation = await startRegistration({
        optionsJSON: options as unknown as Parameters<typeof startRegistration>[0]['optionsJSON'],
      });
      await api.post('auth/passkeys/register', { response: attestation });
      await load();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true);
    try {
      await api.delete(`auth/sessions/${id}`);
      await load();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function logoutAll(): Promise<void> {
    setBusy(true);
    try {
      await api.post('auth/logout-all');
      // Bu cihazın oturumu da düştü — cookie'leri temizleyip girişe gidiyoruz.
      await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.href = '/giris';
    } catch (caught) {
      setError(toMessage(caught));
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">{t('account.security')}</h1>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardTitle>{t('account.twoFactor')}</CardTitle>
        <p className="text-sm">
          {totp === null
            ? t('common.loading')
            : totp.enabled
              ? `${t('account.twoFactorOn')} · ${String(totp.backupCodesRemaining)} yedek kod kaldı`
              : t('account.twoFactorOff')}
        </p>
      </Card>

      <Card>
        <CardTitle>{t('account.passkeys')}</CardTitle>
        {passkeys.length === 0 ? (
          <p className="mb-3 text-sm text-ink-soft">Kayıtlı passkey yok.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between">
                <span>{passkey.deviceLabel ?? passkey.id.slice(0, 8)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void api.delete(`auth/passkeys/${passkey.id}`).then(load)}
                >
                  {t('common.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void addPasskey()}>
          {t('account.addPasskey')}
        </Button>
      </Card>

      <Card>
        <CardTitle>{t('account.sessions')}</CardTitle>
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {session.deviceLabel ?? session.authMethod}
                {session.current ? ` · ${t('account.sessionCurrent')}` : ''}
                <span className="text-ink-soft"> · {session.ip ?? '—'}</span>
              </span>
              {session.current ? null : (
                <Button size="sm" variant="ghost" onClick={() => void revoke(session.id)}>
                  {t('common.delete')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button size="sm" variant="danger" loading={busy} onClick={() => void logoutAll()}>
          {t('account.logoutAll')}
        </Button>
      </Card>
    </div>
  );
}

function toMessage(caught: unknown): string {
  return caught instanceof ApiProblemError
    ? describeProblem(caught.problem, caught.retryAfterSeconds).message
    : networkError().message;
}
