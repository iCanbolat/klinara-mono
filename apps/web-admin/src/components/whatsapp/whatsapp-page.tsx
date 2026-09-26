'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  PERMISSIONS,
  WHATSAPP_WEBHOOK_PATH,
  type UpsertWhatsAppAccountInput,
  type WhatsAppAccount,
  type WhatsAppProvisionResult,
  type WhatsAppTemplate,
  type WhatsAppTestResult,
  type WhatsAppVerifyResult,
} from '@klinara/shared';
import { t, type MessageKey } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { can } from '@/lib/permissions';
import { toMessage } from '@/lib/reports/errors';
import { toFormErrors, type FormErrors } from '@/lib/forms/field-errors';
import { cn } from '@/lib/cn';
import { useSession } from '@/components/session/session-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldSelect } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

/**
 * WhatsApp kurulumu — mobildeki akışın panel karşılığı, bir adım fazlasıyla:
 * Klinara'nın standart şablonlarını kliniğin WABA'sına API ile yüklemek.
 *
 * Token ve app secret YAZILIR ama hiç OKUNMAZ: sunucu yalnız maskesini
 * döndürüyor. Bu yüzden token alanı her kayıtta yeniden isteniyor — "boş
 * bırakırsanız değişmez" demek, sunucunun reddettiği bir form olurdu.
 */
export function WhatsAppPage(): ReactNode {
  const { permissions } = useSession();
  const canTest = can(permissions, PERMISSIONS.NOTIFICATION_SEND);

  /** `undefined` = yükleniyor, `null` = hesap yok. */
  const [account, setAccount] = useState<WhatsAppAccount | null | undefined>(undefined);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [current, list] = await Promise.all([
        api.get<WhatsAppAccount | null>('integrations/whatsapp'),
        api.get<WhatsAppTemplate[]>('integrations/whatsapp/templates'),
      ]);
      setAccount(current ?? null);
      setTemplates(list);
      setError(null);
    } catch (caught) {
      setError(toMessage(caught));
      setAccount((value) => value ?? null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const status = account === undefined ? null : (account?.status ?? 'none');

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={t('whatsapp.title')}
        description={t('whatsapp.description')}
        actions={status === null ? undefined : <StatusBadge status={status} />}
      />
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {account === undefined ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <CredentialsCard account={account} onChanged={load} />
          <TemplatesCard account={account} templates={templates} onChanged={load} />
          <WebhookCard />
          {canTest ? <TestCard account={account} templates={templates} /> : null}
        </>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<string, { label: MessageKey; className: string }> = {
  active: { label: 'whatsapp.status.active', className: 'bg-success-soft text-foreground' },
  unconfigured: { label: 'whatsapp.status.unconfigured', className: 'bg-warning-soft text-foreground' },
  error: { label: 'whatsapp.status.error', className: 'bg-destructive-soft text-foreground' },
  none: { label: 'whatsapp.status.none', className: 'bg-muted text-muted-foreground' },
};

function StatusBadge({ status }: { status: string }): ReactNode {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE['none'];
  if (style === undefined) return null;
  return (
    <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', style.className)}>
      {t(style.label)}
    </span>
  );
}

function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return <h2 className="mb-3 text-title-m text-foreground">{children}</h2>;
}

// ---------------------------------------------------------------------------

function CredentialsCard({
  account,
  onChanged,
}: {
  account: WhatsAppAccount | null;
  onChanged: () => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState({
    wabaId: account?.wabaId ?? '',
    phoneNumberId: account?.phoneNumberId ?? '',
    businessPhone: account?.businessPhone ?? '',
    accessToken: '',
    appSecret: '',
    apiVersion: account?.apiVersion ?? '',
  });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState<'save' | 'verify' | null>(null);
  const [verify, setVerify] = useState<WhatsAppVerifyResult | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy('save');
    setErrors(NO_ERRORS);
    setVerify(null);
    // Meta panelinden kopyalanan değerler çoğu zaman boşluk ya da satır sonu
    // taşıyor; token'da tek bir `\n` "Malformed access token" demek.
    const trimmed = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()]),
    ) as typeof form;
    const body: UpsertWhatsAppAccountInput = {
      wabaId: trimmed.wabaId,
      phoneNumberId: trimmed.phoneNumberId,
      accessToken: trimmed.accessToken,
      ...(trimmed.businessPhone === '' ? {} : { businessPhone: trimmed.businessPhone }),
      ...(trimmed.appSecret === '' ? {} : { appSecret: trimmed.appSecret }),
      ...(trimmed.apiVersion === '' ? {} : { apiVersion: trimmed.apiVersion }),
    };
    try {
      await api.put<WhatsAppAccount>('integrations/whatsapp', body);
      setForm((current) => ({ ...current, accessToken: '', appSecret: '' }));
      toast.success(t('whatsapp.form.saved'));
      await onChanged();
    } catch (caught) {
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(null);
    }
  }

  async function runVerify(): Promise<void> {
    setBusy('verify');
    setErrors(NO_ERRORS);
    try {
      const result = await api.post<WhatsAppVerifyResult>('integrations/whatsapp/verify');
      setVerify(result);
      await onChanged();
    } catch (caught) {
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(null);
    }
  }

  const canSave =
    form.wabaId.trim().length >= 3 &&
    form.phoneNumberId.trim().length >= 3 &&
    form.accessToken.trim().length >= 10;

  return (
    <Card>
      <SectionTitle>{t('whatsapp.step.credentials')}</SectionTitle>

      {account !== null ? (
        <dl className="mb-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t('whatsapp.account.token')}</dt>
            <dd className="font-mono">{account.accessTokenMasked}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('whatsapp.account.webhookSigning')}</dt>
            <dd>
              {account.hasAppSecret
                ? t('whatsapp.account.signingReady')
                : t('whatsapp.account.signingMissing')}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dd className="text-xs text-muted-foreground">
              {account.lastVerifiedAt === null
                ? t('whatsapp.account.neverVerified')
                : t('whatsapp.account.lastVerified', {
                    date: new Date(account.lastVerifiedAt).toLocaleString('tr-TR'),
                  })}
            </dd>
          </div>
          {account.lastError !== null ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t('whatsapp.account.lastError')}</dt>
              <dd className="break-words text-destructive">{account.lastError}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" autoComplete="off">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('whatsapp.form.wabaId')}
            hint={t('whatsapp.form.wabaIdHint')}
            value={form.wabaId}
            onChange={(event) => set('wabaId')(event.target.value)}
            error={errors.fields['wabaId']}
            inputMode="numeric"
            required
          />
          <Field
            label={t('whatsapp.form.phoneNumberId')}
            hint={t('whatsapp.form.phoneNumberIdHint')}
            value={form.phoneNumberId}
            onChange={(event) => set('phoneNumberId')(event.target.value)}
            error={errors.fields['phoneNumberId']}
            inputMode="numeric"
            required
          />
        </div>
        <Field
          label={t('whatsapp.form.accessToken')}
          hint={
            account === null
              ? t('whatsapp.form.accessTokenHint')
              : t('whatsapp.form.accessTokenSaved', { masked: account.accessTokenMasked })
          }
          type="password"
          // `one-time-code`: tarayıcı alanı parola sanıp kaydetmeyi/üretmeyi
          // önermesin (iOS'taki aynı sorun, `WhatsAppSettingsEditorView`).
          autoComplete="one-time-code"
          spellCheck={false}
          value={form.accessToken}
          onChange={(event) => set('accessToken')(event.target.value)}
          error={errors.fields['accessToken']}
          required
        />
        <Field
          label={t('whatsapp.form.appSecret')}
          hint={
            account?.hasAppSecret === true
              ? t('whatsapp.form.appSecretKeep')
              : t('whatsapp.form.appSecretHint')
          }
          type="password"
          autoComplete="one-time-code"
          spellCheck={false}
          value={form.appSecret}
          onChange={(event) => set('appSecret')(event.target.value)}
          error={errors.fields['appSecret']}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('whatsapp.form.businessPhone')}
            value={form.businessPhone}
            onChange={(event) => set('businessPhone')(event.target.value)}
            error={errors.fields['businessPhone']}
            inputMode="tel"
            placeholder="+905321234567"
          />
          <Field
            label={t('whatsapp.form.apiVersion')}
            value={form.apiVersion}
            onChange={(event) => set('apiVersion')(event.target.value)}
            error={errors.fields['apiVersion']}
            placeholder="v26.0"
          />
        </div>

        {errors.message !== null ? <Alert tone="danger">{errors.message}</Alert> : null}
        {verify !== null ? (
          <Alert tone={verify.ok ? 'ok' : 'danger'}>
            {verify.ok
              ? t('whatsapp.verify.ok', { count: verify.templateCount })
              : t('whatsapp.verify.failed', { error: verify.error ?? '' })}
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy === 'save'} disabled={!canSave || busy !== null}>
            {t('whatsapp.form.save')}
          </Button>
          {account !== null ? (
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'verify'}
              disabled={busy !== null}
              onClick={() => void runVerify()}
            >
              <ShieldCheck aria-hidden="true" />
              {t('whatsapp.verify')}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------

const TEMPLATE_STATUS: Record<string, { label: MessageKey; className: string }> = {
  approved: { label: 'whatsapp.templates.approved', className: 'bg-success-soft' },
  pending: { label: 'whatsapp.templates.pending', className: 'bg-warning-soft' },
  rejected: { label: 'whatsapp.templates.rejected', className: 'bg-destructive-soft' },
};

/** Klinara'nın standart setinden mi — yalnız görsel işaret için. */
const isStandard = (name: string): boolean => name.startsWith('klinara_') || name === 'booking_otp';

function TemplatesCard({
  account,
  templates,
  onChanged,
}: {
  account: WhatsAppAccount | null;
  templates: WhatsAppTemplate[];
  onChanged: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState<'provision' | 'refresh' | null>(null);
  const [result, setResult] = useState<WhatsAppProvisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...templates].sort(
        (a, b) => Number(isStandard(b.name)) - Number(isStandard(a.name)) || a.name.localeCompare(b.name),
      ),
    [templates],
  );

  async function provision(): Promise<void> {
    setBusy('provision');
    setError(null);
    setResult(null);
    try {
      const outcome = await api.post<WhatsAppProvisionResult>(
        'integrations/whatsapp/templates/provision',
      );
      setResult(outcome);
      await onChanged();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function refresh(): Promise<void> {
    // Yansımayı tazelemenin yolu doğrulama: Meta'dan liste yeniden çekiliyor.
    setBusy('refresh');
    setError(null);
    try {
      const outcome = await api.post<WhatsAppVerifyResult>('integrations/whatsapp/verify');
      if (!outcome.ok) setError(t('whatsapp.verify.failed', { error: outcome.error ?? '' }));
      await onChanged();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <SectionTitle>{t('whatsapp.step.templates')}</SectionTitle>
      <p className="mb-4 text-sm text-muted-foreground">{t('whatsapp.templates.description')}</p>

      {account === null ? (
        <Alert tone="info">{t('whatsapp.templates.needsAccount')}</Alert>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button loading={busy === 'provision'} disabled={busy !== null} onClick={() => void provision()}>
            <Upload aria-hidden="true" />
            {t('whatsapp.templates.provision')}
          </Button>
          <Button
            variant="secondary"
            loading={busy === 'refresh'}
            disabled={busy !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" />
            {t('whatsapp.templates.refresh')}
          </Button>
        </div>
      )}

      {error !== null ? (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      ) : null}

      {result !== null ? (
        <Alert tone={result.failed > 0 ? 'warn' : 'ok'} className="mb-4">
          <p>
            {result.created > 0
              ? t('whatsapp.templates.provisioned', { created: result.created })
              : t('whatsapp.templates.provisionedNone')}
          </p>
          {result.failed > 0 ? (
            <>
              <p className="mt-2 font-medium">
                {t('whatsapp.templates.provisionFailed', { failed: result.failed })}
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.results
                  .filter((row) => row.outcome === 'failed')
                  .map((row) => (
                    <li key={row.name} className="break-words">
                      <span className="font-mono">{row.name}</span>: {row.error}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </Alert>
      ) : null}

      {account !== null && sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('whatsapp.templates.empty')}</p>
      ) : null}

      {sorted.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t('whatsapp.templates.name')}</th>
                <th className="py-2 pr-3 font-medium">{t('whatsapp.templates.category')}</th>
                <th className="py-2 font-medium">{t('whatsapp.templates.status')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((template) => {
                const status = TEMPLATE_STATUS[template.status];
                return (
                  <tr key={`${template.name}:${template.language}`} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs">{template.name}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">({template.language})</span>
                      {isStandard(template.name) ? (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {t('whatsapp.templates.standard')}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{template.category ?? '—'}</td>
                    <td className="py-2">
                      {status !== undefined ? (
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.className)}>
                          {t(status.label)}
                        </span>
                      ) : (
                        template.status
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function WebhookCard(): ReactNode {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(WHATSAPP_WEBHOOK_PATH);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano izni yoksa kullanıcı metni elle seçer; yol zaten ekranda.
    }
  }

  return (
    <Card>
      <SectionTitle>{t('whatsapp.step.webhook')}</SectionTitle>
      <p className="mb-3 text-sm text-muted-foreground">{t('whatsapp.webhook.description')}</p>
      <p className="text-xs font-medium text-muted-foreground">{t('whatsapp.webhook.path')}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-sm">
          {WHATSAPP_WEBHOOK_PATH}
        </code>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={copied ? t('common.copied') : t('common.copy')}
          onClick={() => void copy()}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('whatsapp.webhook.example', { path: WHATSAPP_WEBHOOK_PATH })}
      </p>
      <Alert tone="info" className="mt-3">
        {t('whatsapp.webhook.live')}
      </Alert>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** Meta'nın her yeni WABA'da hazır gelen şablonu — onay beklemeden test için. */
const HELLO_WORLD = { name: 'hello_world', language: 'en_US' };

function TestCard({
  account,
  templates,
}: {
  account: WhatsAppAccount | null;
  templates: WhatsAppTemplate[];
}): ReactNode {
  // Parametresiz, butonsuz, onaylı şablonlar: test ucu hiçbir parametre
  // göndermiyor. Yansıma medya başlığını tutmuyor; görselli pazarlama
  // şablonları da genelde buton taşıdığı için buton süzgeci onları da eliyor.
  const options = useMemo(() => {
    const approved = templates
      .filter(
        (template) =>
          template.status === 'approved' &&
          template.bodyVariableCount === 0 &&
          template.buttons.length === 0,
      )
      .map((template) => ({ name: template.name, language: template.language }));
    return approved.some((option) => option.name === HELLO_WORLD.name)
      ? approved
      : [HELLO_WORLD, ...approved];
  }, [templates]);

  const [to, setTo] = useState('');
  const [choice, setChoice] = useState(`${HELLO_WORLD.name}|${HELLO_WORLD.language}`);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [sent, setSent] = useState(false);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    const [templateName, templateLanguage] = choice.split('|');
    if (templateName === undefined) return;
    setBusy(true);
    setErrors(NO_ERRORS);
    setSent(false);
    try {
      await api.post<WhatsAppTestResult>('integrations/whatsapp/test', {
        to: to.trim(),
        templateName,
        ...(templateLanguage === undefined ? {} : { templateLanguage }),
      });
      setSent(true);
    } catch (caught) {
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle>{t('whatsapp.step.test')}</SectionTitle>
      <p className="mb-4 text-sm text-muted-foreground">{t('whatsapp.test.description')}</p>
      <form onSubmit={(event) => void send(event)} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('whatsapp.test.to')}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            error={errors.fields['to']}
            inputMode="tel"
            placeholder="+905321234567"
            required
          />
          <FieldSelect
            label={t('whatsapp.test.template')}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            {options.map((option) => (
              <option key={`${option.name}|${option.language}`} value={`${option.name}|${option.language}`}>
                {option.name === HELLO_WORLD.name
                  ? t('whatsapp.test.helloWorld')
                  : `${option.name} (${option.language})`}
              </option>
            ))}
          </FieldSelect>
        </div>
        {errors.message !== null ? <Alert tone="danger">{errors.message}</Alert> : null}
        {sent ? <Alert tone="ok">{t('whatsapp.test.sent')}</Alert> : null}
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          loading={busy}
          disabled={account === null || to.trim().length < 7}
        >
          {t('whatsapp.test.send')}
        </Button>
      </form>
    </Card>
  );
}
