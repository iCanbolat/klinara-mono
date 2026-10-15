'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Circle } from 'lucide-react';
import {
  PLAN_KEYS,
  PLANS,
  type PlanKey,
  type PlatformOwnerInvitationResult,
  type PlatformTenantDetail,
  type TenantStatus,
  type UpdatePlatformTenantInput,
} from '@klinara/shared';
import {
  INVITATION_LABELS,
  platformFetch,
  SETUP_LABELS,
  STATUS_LABELS,
} from '@/components/platform/platform-client';
import { PlatformWhatsAppCard } from '@/components/platform/platform-whatsapp-card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldSelect, FieldTextarea } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';

function numberOrNull(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function PlatformTenantPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<PlatformTenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    platformFetch<PlatformTenantDetail>(`tenants/${id}`)
      .then(setTenant)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Klinik alınamadı'));
  }, [id]);

  useEffect(load, [load]);

  if (error !== null) return <Alert tone="danger">{error}</Alert>;
  if (tenant === null) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/platform" className="w-fit text-sm text-muted-foreground hover:underline">
          ← Klinikler
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-display-m text-foreground">{tenant.name}</h1>
          <Badge variant={tenant.status === 'suspended' ? 'destructive' : 'secondary'}>
            {STATUS_LABELS[tenant.status]}
          </Badge>
          <Badge variant="outline">{PLANS[tenant.planKey].name}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {tenant.slug} · {new Date(tenant.createdAt).toLocaleDateString('tr-TR')} tarihinde açıldı
        </p>
      </div>

      {/*
        Laptop ve üstü: solda iş formları, sağda sabit özet sütunu. Formlar
        geniş alanı kullanır; özet kartları içerik kadar yer kaplar ve
        kaydırırken görünür kalır.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <PlatformWhatsAppCard tenantId={tenant.id} onChanged={load} />
          <PlanCard
            key={`${tenant.planKey}-${tenant.status}`}
            tenant={tenant}
            onSaved={setTenant}
          />
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <UsageCard tenant={tenant} />
          <SetupCard tenant={tenant} />
          <OwnerCard tenant={tenant} onChanged={load} />
          <BranchesCard tenant={tenant} />
        </aside>
      </div>
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }): ReactNode {
  // Kırmızı yalnız AŞIMDA: limite tam oturan klinik normal bir durumdadır.
  const over = used > limit;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className={over ? 'font-medium text-destructive' : 'text-muted-foreground'}>
          {used} / {limit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={over ? 'h-full bg-destructive' : 'h-full bg-primary'}
          style={{ width: `${Math.round(Math.min(1, used / Math.max(1, limit)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function UsageCard({ tenant }: { tenant: PlatformTenantDetail }): ReactNode {
  return (
    <Card>
      <CardTitle className="text-base">Kullanım</CardTitle>
      <div className="mt-3 flex flex-col gap-3">
        <Meter label="Şube" used={tenant.usage.branches} limit={tenant.limits.maxBranches} />
        <Meter
          label="Hekim / uygulayıcı"
          used={tenant.usage.practitioners}
          limit={tenant.limits.maxPractitioners}
        />
      </div>
    </Card>
  );
}

function SetupCard({ tenant }: { tenant: PlatformTenantDetail }): ReactNode {
  const done = tenant.setup.steps.filter((step) => step.done).length;
  const total = tenant.setup.steps.length;
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <CardTitle className="text-base">Kurulum</CardTitle>
        <span className="text-sm text-muted-foreground">
          {done}/{total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.round((done / total) * 100)}%` }}
        />
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {tenant.setup.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2">
            {step.done ? (
              <Check className="size-4 shrink-0 text-primary" aria-hidden />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={step.done ? undefined : 'text-muted-foreground'}>
              {SETUP_LABELS[step.key]}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BranchesCard({ tenant }: { tenant: PlatformTenantDetail }): ReactNode {
  return (
    <Card>
      <CardTitle className="text-base">Şubeler</CardTitle>
      <ul className="mt-3 flex flex-col divide-y divide-border text-sm">
        {tenant.branches.map((branch) => (
          <li key={branch.id} className="flex items-center justify-between gap-3 py-1.5">
            <span className="truncate">{branch.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {branch.isActive ? branch.slug : 'pasif'}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OwnerCard({
  tenant,
  onChanged,
}: {
  tenant: PlatformTenantDetail;
  onChanged: () => void;
}): ReactNode {
  const invitation = tenant.ownerInvitation;
  const [email, setEmail] = useState(invitation?.email ?? '');
  const [busy, setBusy] = useState(false);

  async function resend(): Promise<void> {
    setBusy(true);
    try {
      const result = await platformFetch<PlatformOwnerInvitationResult>(
        `tenants/${tenant.id}/owner-invitation`,
        {
          method: 'POST',
          body: email.trim() === '' ? {} : { email: email.trim() },
        },
      );
      if (result.mailDelivered === false) toast.error('Davet yenilendi ama e-posta gönderilemedi.');
      else toast.success(`Davet ${result.email} adresine gönderildi.`);
      if (result.link !== undefined) {
        toast.info('Geliştirme bağlantısı', { description: result.link, duration: 20_000 });
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Davet gönderilemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle className="text-base">İşletme sahibi</CardTitle>
      <p className="mt-1 text-sm text-muted-foreground">
        {invitation === null
          ? 'Davet kaydı yok.'
          : `${INVITATION_LABELS[invitation.state]} · ${new Date(invitation.createdAt).toLocaleDateString('tr-TR')}`}
      </p>
      {invitation?.state === 'accepted' ? (
        <p className="mt-2 truncate text-sm" title={invitation.email}>
          {invitation.email}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <Field
            label="E-posta"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            hint="Bekleyen davet iptal edilir, yeni bağlantı gönderilir."
          />
          <Button
            size="sm"
            variant="secondary"
            className="self-end"
            loading={busy}
            onClick={() => void resend()}
          >
            Daveti yeniden gönder
          </Button>
        </div>
      )}
    </Card>
  );
}

function PlanCard({
  tenant,
  onSaved,
}: {
  tenant: PlatformTenantDetail;
  onSaved: (tenant: PlatformTenantDetail) => void;
}): ReactNode {
  const [planKey, setPlanKey] = useState<PlanKey>(tenant.planKey);
  const [status, setStatus] = useState<TenantStatus>(tenant.status);
  const [maxBranches, setMaxBranches] = useState(tenant.maxBranchesOverride?.toString() ?? '');
  const [maxPractitioners, setMaxPractitioners] = useState(
    tenant.maxPractitionersOverride?.toString() ?? '',
  );
  const [note, setNote] = useState(tenant.planNote ?? '');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (status === 'suspended' && tenant.status !== 'suspended') {
      if (
        !window.confirm(`${tenant.name} askıya alınsın mı? Klinik panele ve uygulamalara giremez.`)
      )
        return;
    }
    setBusy(true);
    const input: UpdatePlatformTenantInput = {
      planKey,
      status,
      maxBranchesOverride: numberOrNull(maxBranches),
      maxPractitionersOverride: numberOrNull(maxPractitioners),
      planNote: note.trim() === '' ? null : note.trim(),
    };
    try {
      onSaved(
        await platformFetch<PlatformTenantDetail>(`tenants/${tenant.id}`, {
          method: 'PATCH',
          body: input,
        }),
      );
      toast.success('Kaydedildi.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  const plan = PLANS[planKey];
  const over =
    tenant.usage.branches > tenant.limits.maxBranches ||
    tenant.usage.practitioners > tenant.limits.maxPractitioners;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Plan ve durum</CardTitle>
          <CardDescription>
            Ödeme altyapısı yok; plan elle atanır. Limit yalnız yeni eklemede uygulanır.
          </CardDescription>
        </div>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {over ? (
          <Alert tone="warn">Klinik plan limitinin üstünde; yeni şube/hekim ekleyemez.</Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FieldSelect
            label="Plan"
            value={planKey}
            onChange={(event) => setPlanKey(event.target.value as PlanKey)}
          >
            {PLAN_KEYS.map((key) => (
              <option key={key} value={key}>
                {PLANS[key].name}
              </option>
            ))}
          </FieldSelect>
          <FieldSelect
            label="Durum"
            value={status}
            onChange={(event) => setStatus(event.target.value as TenantStatus)}
          >
            {(Object.keys(STATUS_LABELS) as TenantStatus[]).map((key) => (
              <option key={key} value={key}>
                {STATUS_LABELS[key]}
              </option>
            ))}
          </FieldSelect>
          <Field
            label="Şube limiti"
            type="number"
            min={1}
            placeholder={`Plan: ${plan.maxBranches}`}
            value={maxBranches}
            onChange={(event) => setMaxBranches(event.target.value)}
          />
          <Field
            label="Hekim limiti"
            type="number"
            min={1}
            placeholder={`Plan: ${plan.maxPractitioners}`}
            value={maxPractitioners}
            onChange={(event) => setMaxPractitioners(event.target.value)}
          />
        </div>
        <FieldTextarea
          label="Not"
          hint="Fiyat anlaşması, fatura bilgisi vb. Yalnız platformda görünür. Limit alanları boşsa planın limiti geçerlidir."
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
        />
        <CardFooter className="mt-0 justify-end">
          <Button type="submit" size="sm" loading={busy}>
            Planı kaydet
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
