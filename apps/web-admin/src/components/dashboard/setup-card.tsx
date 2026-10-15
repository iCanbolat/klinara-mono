'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Check, Circle } from 'lucide-react';
import { PERMISSIONS, type SetupStepKey, type TenantSetupStatus } from '@klinara/shared';
import { useSession } from '@/components/session/session-provider';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { t, type MessageKey } from '@/i18n/tr';
import { api } from '@/lib/api/client';

/** Her adımın işini yapan ekran. */
const STEP_PATHS: Record<SetupStepKey, string> = {
  branch: '/personel',
  hours: '/calisma-saatleri',
  services: '/katalog',
  practitioners: '/personel',
  whatsapp: '/whatsapp',
  bookingPage: '/sayfa',
};

/**
 * Elden kurulum kontrol listesi — tüm adımlar tamamlanınca kaybolur.
 *
 * Aynı hesap platform ekranında da görünüyor (`tenant/setup-status`), yani
 * kurulumu yapan ekip ile klinik aynı listeye bakıyor.
 */
export function SetupCard(): ReactNode {
  const { permissions } = useSession();
  const allowed = permissions.includes(PERMISSIONS.TENANT_READ);
  const [status, setStatus] = useState<TenantSetupStatus | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    api
      .get<TenantSetupStatus>('tenant/setup-status', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [allowed]);

  if (!allowed || status === null || status.complete) return null;
  const done = status.steps.filter((step) => step.done).length;

  return (
    <Card aria-labelledby="dashboard-setup">
      <CardTitle id="dashboard-setup">{t('setup.title')}</CardTitle>
      <CardDescription>{t('setup.progress', { done, total: status.steps.length })}</CardDescription>
      <ul className="grid gap-2 sm:grid-cols-2">
        {status.steps.map((step) => (
          <li key={step.key}>
            <Link
              href={STEP_PATHS[step.key]}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              {step.done ? (
                <Check className="size-4 shrink-0 text-primary" aria-hidden />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className={step.done ? 'text-muted-foreground line-through' : undefined}>
                {t(`setup.${step.key}` as MessageKey)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
