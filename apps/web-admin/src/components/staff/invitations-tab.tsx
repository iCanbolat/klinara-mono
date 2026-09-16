'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Invitation } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { roleName } from '@/lib/staff/memberships';
import { useBranch } from '@/components/session/branch-provider';
import { DataPage } from '@/components/data-page/data-page';
import { DataTable, type DataColumn } from '@/components/data-page/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { InviteDialog } from './invite-dialog';

const DATE = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Bekleyen davetler. Kabul edilmiş ve iptal edilmiş davetler listelenmiyor —
 * kabul edilen kişi zaten Personel sekmesinde; burada yalnız "yolda" olanlar.
 * Süresi dolmuş davet listede kalıyor (rozetle): kullanıcı onu görüp iptal
 * edip yeniden davet etmeli, sessizce kaybolması "davet gitmedi mi?" sorusudur.
 */
export function InvitationsTab(): ReactNode {
  const { branches } = useBranch();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Süresi doldu" hesabının saati — yükleme anında donduruluyor (render saf kalsın).
  const [now, setNow] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [inviting, setInviting] = useState(false);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const { data } = await api.get<{ data: Invitation[] }>('invitations', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setNow(Date.now());
        setInvitations(data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [nonce]);

  const pending = useMemo(
    () =>
      (invitations ?? [])
        .filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [invitations],
  );

  async function revoke(invitation: Invitation): Promise<void> {
    try {
      await api.delete(`invitations/${invitation.id}`);
      toast.success(t('invites.revoked'));
      setInvitations((current) => (current ?? []).filter((row) => row.id !== invitation.id));
    } catch (caught) {
      toast.error(toMessage(caught) ?? t('error.title'));
    }
  }

  const branchName = (id: string | null): string =>
    id === null
      ? t('staff.tenantWide')
      : (branches.find((branch) => branch.id === id)?.name ?? t('staff.inaccessibleBranch'));

  const isExpired = (invitation: Invitation): boolean =>
    new Date(invitation.expiresAt).getTime() < now;

  const statusBadge = (invitation: Invitation): ReactNode =>
    isExpired(invitation) ? (
      <Badge variant="outline" className="text-destructive">
        {t('invites.expired')}
      </Badge>
    ) : (
      <Badge variant="secondary">{t('invites.pending')}</Badge>
    );

  const revokeButton = (invitation: Invitation): ReactNode => (
    <ConfirmButton
      type="button"
      variant="ghost"
      size="sm"
      destructive
      title={t('invites.revokeTitle')}
      description={t('invites.revokeBody')}
      confirmLabel={t('invites.revoke')}
      onConfirm={() => void revoke(invitation)}
    >
      {t('invites.revoke')}
    </ConfirmButton>
  );

  const columns: DataColumn<Invitation>[] = [
    {
      key: 'email',
      header: t('invites.email'),
      render: (invitation) => <span className="text-body-emphasis">{invitation.email}</span>,
    },
    {
      key: 'role',
      header: t('invites.role'),
      render: (invitation) =>
        `${roleName(invitation.roleKey)} · ${branchName(invitation.branchId)}`,
    },
    {
      key: 'expires',
      header: t('invites.expires'),
      render: (invitation) => (
        <span className="flex flex-wrap items-center gap-2">
          {DATE.format(new Date(invitation.expiresAt))}
          {statusBadge(invitation)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('list.actions')}</span>,
      align: 'end',
      render: revokeButton,
    },
  ];

  return (
    <>
      <DataPage
        actions={
          <Button type="button" onClick={() => setInviting(true)}>
            {t('invites.new')}
          </Button>
        }
        rows={pending}
        rowKey={(invitation) => invitation.id}
        loading={invitations === null && error === null}
        error={error}
        onRetry={reload}
        emptyTitle={t('invites.empty')}
        emptyMessage={t('invites.hint')}
        viewStorageKey="klinara.admin.view.invitations"
        pagination={{ mode: 'client' }}
        renderTable={(rows) => (
          <DataTable
            caption={t('invites.title')}
            columns={columns}
            rows={rows}
            rowKey={(invitation) => invitation.id}
          />
        )}
        renderCard={(invitation) => (
          <Card className="flex h-full flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-body-emphasis">{invitation.email}</p>
              {statusBadge(invitation)}
            </div>
            <p className="text-xs text-muted-foreground">
              {roleName(invitation.roleKey)} · {branchName(invitation.branchId)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('invites.expires')}: {DATE.format(new Date(invitation.expiresAt))}
            </p>
            <div className="mt-auto flex justify-end border-t border-border pt-2">
              {revokeButton(invitation)}
            </div>
          </Card>
        )}
      />

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onSent={(invitation) => {
          setInviting(false);
          setInvitations((current) => [invitation, ...(current ?? [])]);
          if (invitation.link !== undefined) {
            // Üretim dışında e-posta loga gidiyor; bağlantıyı elde etmenin tek yolu bu.
            toast.info(t('invites.devLink'), { description: invitation.link, duration: 20_000 });
          }
        }}
      />
    </>
  );
}
