'use client';

import { AlertTriangle, Check, Clock, Pause } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DomainVerificationStatus } from '@klinara/shared';
import { statusView, type StatusTone } from '@/lib/domains/status';
import { t } from '@/i18n/tr';

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'border-success/30 bg-success-soft text-success',
  warn: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-destructive/30 bg-destructive-soft text-destructive',
  info: 'border-border bg-muted text-muted-foreground',
};

const ICONS = { check: Check, clock: Clock, alert: AlertTriangle, pause: Pause } as const;

/**
 * Durum rozeti.
 *
 * İkon + METİN birlikte: renk tek başına anlam taşımamalı. Renk körü bir
 * kullanıcı için yeşil ve turuncu bir rozet aynı görünür ve "etkin" ile
 * "sertifika bekleniyor" arasındaki fark tam da bu ekranda önemli.
 */
export function StatusBadge({ status }: { status: DomainVerificationStatus }): ReactNode {
  const view = statusView(status);
  const Icon = ICONS[view.icon];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[view.tone]}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {t(view.labelKey)}
    </span>
  );
}
