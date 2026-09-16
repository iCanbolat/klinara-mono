import type { ReactNode } from 'react';
import type { StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/** Personel listesinin kart görünümü. Eylemler sayfadan geliyor (izne bağlı). */
export function StaffCard({
  profile,
  serviceNames,
  roles,
  actions,
}: {
  profile: StaffProfile;
  serviceNames: string;
  roles?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-body-emphasis">{profile.userFullName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {profile.title ?? '—'} · {profile.userEmail}
          </p>
        </div>
        {!profile.isActive ? (
          <Badge variant="outline" className="text-muted-foreground">
            {t('list.inactive')}
          </Badge>
        ) : null}
      </div>

      {roles}

      <p className="line-clamp-2 text-xs text-muted-foreground">{serviceNames}</p>

      {actions === undefined ? null : (
        <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {actions}
        </div>
      )}
    </Card>
  );
}
