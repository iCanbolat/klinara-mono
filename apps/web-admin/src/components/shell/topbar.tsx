'use client';

import type { ReactNode } from 'react';
import { useSession } from '@/components/session/session-provider';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';

export function Topbar(): ReactNode {
  const { me } = useSession();

  async function logout(): Promise<void> {
    await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/giris';
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-card px-4">
      <span className="text-sm font-semibold text-ink">{t('app.title')}</span>
      <div className="flex items-center gap-3">
        {me !== null ? <span className="text-sm text-ink-soft">{me.user.email}</span> : null}
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          {t('nav.logout')}
        </Button>
      </div>
    </header>
  );
}
