'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { SessionStep, TenantOption } from '@klinara/shared';
import { ApiProblemError, noteSessionExpiry, sessionCall } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Kiracı seçimi.
 *
 * Liste `GET /api/session/challenge`ten geliyor, bir önceki ekranın React
 * durumundan DEĞİL: kullanıcı sayfayı yenilerse ya da bu adrese doğrudan
 * gelirse liste yine dolu olsun. Challenge cookie'si zaten bu bağlamı taşıyor.
 */
export function TenantPicker(): ReactNode {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/session/challenge', { credentials: 'same-origin' });
      if (!response.ok) {
        // Beş dakikalık pencere doldu; baştan başlamak gerek.
        router.replace('/giris');
        return;
      }
      const step = (await response.json()) as SessionStep;
      setTenants(step.step === 'tenant' ? step.tenants : []);
    })();
  }, [router]);

  async function choose(tenantId: string): Promise<void> {
    setPending(tenantId);
    setError(null);
    try {
      const step = await sessionCall<SessionStep>('tenant', { tenantId });
      if (step.step === 'authenticated') {
        noteSessionExpiry(step.expiresIn);
        router.replace('/');
        router.refresh();
        return;
      }
      if (step.step === 'mfa') {
        router.push('/giris/dogrulama');
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
      setPending(null);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-card p-5 shadow-sm">
      <h1 className="text-lg font-semibold text-ink">{t('auth.tenant.title')}</h1>
      <p className="mt-1 mb-4 text-sm text-ink-soft">{t('auth.tenant.description')}</p>

      {error !== null ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      {tenants === null ? (
        <p className="text-sm text-ink-soft">{t('common.loading')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <Button
                variant="secondary"
                className="w-full justify-between"
                loading={pending === tenant.id}
                onClick={() => void choose(tenant.id)}
              >
                <span>{tenant.name}</span>
                <span className="text-xs text-ink-soft">{tenant.roles.join(', ')}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
