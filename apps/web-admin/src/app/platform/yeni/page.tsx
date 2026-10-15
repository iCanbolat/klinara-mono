'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  PLAN_KEYS,
  PLANS,
  type CreatePlatformTenantInput,
  type PlanKey,
  type PlatformOwnerInvitationResult,
} from '@klinara/shared';
import { platformFetch } from '@/components/platform/platform-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldSelect } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';

/** Türkçe karakterleri sadeleştirip slug önerir; kullanıcı düzeltebilir. */
function slugify(value: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u' };
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıİöşü]/g, (ch) => map[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function optionalNumber(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function NewTenantPage(): ReactNode {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [planKey, setPlanKey] = useState<PlanKey>('klinik');
  const [maxBranches, setMaxBranches] = useState('');
  const [maxPractitioners, setMaxPractitioners] = useState('');
  const [branchName, setBranchName] = useState('Merkez');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const branchesOverride = optionalNumber(maxBranches);
    const practitionersOverride = optionalNumber(maxPractitioners);
    const input: CreatePlatformTenantInput = {
      name: name.trim(),
      slug,
      planKey,
      ...(branchesOverride === undefined ? {} : { maxBranchesOverride: branchesOverride }),
      ...(practitionersOverride === undefined
        ? {}
        : { maxPractitionersOverride: practitionersOverride }),
      branch: { name: branchName.trim(), slug: slugify(branchName) || 'merkez' },
      owner: {
        email: ownerEmail.trim(),
        ...(ownerName.trim() === '' ? {} : { fullName: ownerName.trim() }),
      },
    };
    try {
      const created = await platformFetch<{
        tenant: { id: string };
        ownerInvitation: PlatformOwnerInvitationResult;
      }>('tenants', { method: 'POST', body: input });
      if (created.ownerInvitation.mailDelivered === false) {
        toast.error(
          'Klinik açıldı ama davet e-postası gönderilemedi. Detay sayfasından yeniden gönderin.',
        );
      } else {
        toast.success(`Davet ${created.ownerInvitation.email} adresine gönderildi.`);
      }
      if (created.ownerInvitation.link !== undefined) {
        toast.info('Geliştirme bağlantısı', {
          description: created.ownerInvitation.link,
          duration: 20_000,
        });
      }
      router.push(`/platform/${created.tenant.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Klinik açılamadı');
    } finally {
      setBusy(false);
    }
  }

  const plan = PLANS[planKey];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Yeni klinik"
        description="Klinik, ilk şubesi ve sahip daveti birlikte oluşturulur."
      />
      <form className="grid gap-6 lg:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Klinik</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field
              label="Klinik adı"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
              required
            />
            <Field
              label="Kısa ad (slug)"
              hint="Adreslerde görünür: küçük harf, rakam ve tire."
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]"
              required
            />
            <Field
              label="İlk şube adı"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              required
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Plan ve sahip</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldSelect
              label="Plan"
              value={planKey}
              onChange={(event) => setPlanKey(event.target.value as PlanKey)}
            >
              {PLAN_KEYS.map((key) => (
                <option key={key} value={key}>
                  {PLANS[key].name} — {PLANS[key].maxBranches} şube, {PLANS[key].maxPractitioners}{' '}
                  hekim
                </option>
              ))}
            </FieldSelect>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Şube limiti"
                type="number"
                min={1}
                placeholder={String(plan.maxBranches)}
                hint="Boş: plan limiti"
                value={maxBranches}
                onChange={(event) => setMaxBranches(event.target.value)}
              />
              <Field
                label="Hekim limiti"
                type="number"
                min={1}
                placeholder={String(plan.maxPractitioners)}
                hint="Boş: plan limiti"
                value={maxPractitioners}
                onChange={(event) => setMaxPractitioners(event.target.value)}
              />
            </div>
            <Field
              label="Sahibin e-postası"
              type="email"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              required
            />
            <Field
              label="Sahibin adı (isteğe bağlı)"
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 lg:col-span-2">
          {error === null ? null : <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => router.push('/platform')}>
              Vazgeç
            </Button>
            <Button type="submit" loading={busy}>
              Kliniği aç ve davet gönder
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
