'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import type {
  UpsertWhatsAppAccountInput,
  WhatsAppAccount,
  WhatsAppProvisionResult,
  WhatsAppTemplate,
  WhatsAppVerifyResult,
} from '@klinara/shared';
import { platformFetch } from '@/components/platform/platform-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';

const STATUS_LABELS: Record<string, string> = {
  unconfigured: 'Doğrulanmadı',
  active: 'Bağlı',
  error: 'Hata',
};

/**
 * Elden WABA kurulumu — klinik ekranındaki (`/whatsapp`) akışın platform
 * karşılığı: kimlik bilgisi → Meta doğrulaması → standart şablonlar.
 *
 * Token her kayıtta yeniden girilir (kayıtlı değer okunamaz, yalnız son 4
 * hanesi görünür). App secret boş bırakılırsa kayıtlı değer korunur.
 */
export function PlatformWhatsAppCard({
  tenantId,
  onChanged,
}: {
  tenantId: string;
  onChanged: () => void;
}): ReactNode {
  const base = `tenants/${tenantId}/whatsapp`;
  const [account, setAccount] = useState<WhatsAppAccount | null | undefined>(undefined);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'verify' | 'provision' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    platformFetch<{ account: WhatsAppAccount | null; templates: WhatsAppTemplate[] }>(base)
      .then((body) => {
        setAccount(body.account);
        setTemplates(body.templates);
        if (body.account !== null) {
          setWabaId(body.account.wabaId);
          setPhoneNumberId(body.account.phoneNumberId);
          setBusinessPhone(body.account.businessPhone ?? '');
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'WhatsApp bilgisi alınamadı'),
      );
  }, [base]);

  useEffect(load, [load]);

  async function run<T>(
    kind: 'save' | 'verify' | 'provision',
    call: () => Promise<T>,
  ): Promise<T | null> {
    setBusy(kind);
    setError(null);
    try {
      return await call();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem başarısız');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    const body: UpsertWhatsAppAccountInput = {
      wabaId: wabaId.trim(),
      phoneNumberId: phoneNumberId.trim(),
      accessToken: accessToken.trim(),
      ...(businessPhone.trim() === '' ? {} : { businessPhone: businessPhone.trim() }),
      ...(appSecret.trim() === '' ? {} : { appSecret: appSecret.trim() }),
    };
    const saved = await run('save', () =>
      platformFetch<WhatsAppAccount>(base, { method: 'PUT', body }),
    );
    if (saved === null) return;
    setAccessToken('');
    setAppSecret('');
    toast.success('Kaydedildi. Şimdi Meta’ya doğrulatın.');
    load();
    onChanged();
  }

  async function verify(): Promise<void> {
    const result = await run('verify', () =>
      platformFetch<WhatsAppVerifyResult>(`${base}/verify`, { method: 'POST' }),
    );
    if (result === null) return;
    if (result.ok) toast.success(`Bağlantı doğrulandı · ${result.templateCount} şablon`);
    else setError(result.error ?? 'Meta doğrulaması başarısız');
    load();
    onChanged();
  }

  async function provision(): Promise<void> {
    const result = await run('provision', () =>
      platformFetch<WhatsAppProvisionResult>(`${base}/templates/provision`, { method: 'POST' }),
    );
    if (result === null) return;
    if (result.failed > 0) {
      const failed = result.results.filter((item) => item.outcome === 'failed');
      setError(failed.map((item) => `${item.name}: ${item.error ?? 'hata'}`).join(' · '));
    } else {
      toast.success(`${result.created} şablon gönderildi; Meta onayı birkaç dakika sürebilir.`);
    }
    load();
  }

  const approved = templates.filter((template) => template.status === 'APPROVED').length;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>WhatsApp (WABA)</CardTitle>
          <CardDescription>
            1) Kimlik bilgilerini kaydedin · 2) Meta’ya doğrulatın · 3) Standart şablonları gönderin
          </CardDescription>
        </div>
        {account === undefined ? null : (
          <Badge variant={account?.status === 'active' ? 'secondary' : 'outline'}>
            {account === null ? 'Kurulmadı' : (STATUS_LABELS[account.status] ?? account.status)}
          </Badge>
        )}
      </CardHeader>

      <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        {error === null ? null : <Alert tone="danger">{error}</Alert>}
        {account?.lastError ? <Alert tone="warn">Son hata: {account.lastError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field
            label="WABA ID"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            required
          />
          <Field
            label="Phone number ID"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            required
          />
          <Field
            label="İşletme telefonu"
            placeholder="+90…"
            value={businessPhone}
            onChange={(e) => setBusinessPhone(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Kalıcı erişim token’ı"
            type="password"
            autoComplete="off"
            hint={
              account?.accessTokenMasked
                ? `Kayıtlı: ${account.accessTokenMasked} · her kayıtta yeniden girilir`
                : 'System user token (kalıcı)'
            }
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            required
          />
          <Field
            label="App secret"
            type="password"
            autoComplete="off"
            hint={
              account?.hasAppSecret
                ? 'Kayıtlı · boş bırakırsanız korunur'
                : 'Gelen mesaj webhook imzası için gerekli'
            }
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
        </div>

        <CardFooter className="mt-0 flex-wrap justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {templates.length} şablon, {approved} onaylı
            {account?.lastVerifiedAt
              ? ` · son doğrulama ${new Date(account.lastVerifiedAt).toLocaleString('tr-TR')}`
              : ''}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={busy === 'verify'}
              disabled={busy !== null || !account}
              onClick={() => void verify()}
            >
              Meta’ya doğrulat
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={busy === 'provision'}
              disabled={busy !== null || account?.status !== 'active'}
              onClick={() => void provision()}
            >
              Şablonları gönder
            </Button>
            <Button type="submit" size="sm" loading={busy === 'save'} disabled={busy !== null}>
              Kimlik bilgilerini kaydet
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
