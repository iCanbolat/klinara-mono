'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { PLANS, type PlatformTenant } from '@klinara/shared';
import {
  INVITATION_LABELS,
  platformFetch,
  STATUS_LABELS,
} from '@/components/platform/platform-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function usage(used: number, limit: number): ReactNode {
  return (
    <span className={used > limit ? 'font-medium text-destructive' : undefined}>
      {used}/{limit}
    </span>
  );
}

export default function PlatformTenantsPage(): ReactNode {
  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformFetch<{ data: PlatformTenant[] }>('tenants')
      .then((body) => setTenants(body.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Liste alınamadı'));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Klinikler"
        description="Elden kurulum: kliniği aç, planı ata, sahibin davetini takip et."
        actions={
          <Link href="/platform/yeni" className={buttonVariants({ variant: 'primary' })}>
            Yeni klinik
          </Link>
        }
      />
      {error === null ? null : <Alert tone="danger">{error}</Alert>}
      {tenants === null && error === null ? (
        <Skeleton className="h-40 w-full" />
      ) : tenants !== null && tenants.length === 0 ? (
        <Alert tone="info">Henüz klinik yok.</Alert>
      ) : tenants === null ? null : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Klinik</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Şube</TableHead>
                <TableHead>Hekim</TableHead>
                <TableHead>Sahip</TableHead>
                <TableHead>Açılış</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link href={`/platform/${tenant.id}`} className="font-medium hover:underline">
                      {tenant.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{tenant.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={tenant.status === 'suspended' ? 'destructive' : 'secondary'}>
                      {STATUS_LABELS[tenant.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{PLANS[tenant.planKey].name}</TableCell>
                  <TableCell>{usage(tenant.usage.branches, tenant.limits.maxBranches)}</TableCell>
                  <TableCell>
                    {usage(tenant.usage.practitioners, tenant.limits.maxPractitioners)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {tenant.ownerInvitation === null
                      ? '—'
                      : INVITATION_LABELS[tenant.ownerInvitation.state]}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(tenant.createdAt).toLocaleDateString('tr-TR')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
