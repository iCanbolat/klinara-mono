'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Archive, ChevronRight, Plus } from 'lucide-react';
import { CONSENT_LIMITS, PERMISSIONS, type ConsentTemplate, type Service } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { useSession } from '@/components/session/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

/**
 * İşlem onamı şablonları.
 *
 * KVKK editörüyle (`/onam` ilk sekme) aynı UX: yayındaki metin salt okunur,
 * düzenleme taslakta, yayın geri alınamaz ve onay arkasında. Şablon silinmez,
 * arşivlenir — alınmış imzalar ona bağlı.
 */
export function TreatmentTemplates(): ReactNode {
  const { permissions } = useSession();
  const canManage = permissions.includes(PERMISSIONS.CONSENT_MANAGE);
  const [templates, setTemplates] = useState<ConsentTemplate[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<ConsentTemplate[] | null> => {
    try {
      const list = await api.get<ConsentTemplate[]>('consent-templates');
      setTemplates(list);
      return list;
    } catch (caught) {
      setError(toMessage(caught));
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
    void (async () => {
      try {
        const result = await api.get<{ data: Service[] }>('services');
        setServices(result.data);
      } catch {
        // Hizmet adları yalnız bağlantı listesini okunur kılıyor; yoksa sayı gösterilir.
      }
    })();
  }, [load]);

  const serviceNames = useMemo(
    () => new Map(services.map((service) => [service.id, service.name])),
    [services],
  );

  if (templates === null) {
    return error !== null ? (
      <Alert tone="danger">{error}</Alert>
    ) : (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const selected = templates.find((template) => template.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-end gap-3">
        {canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
          >
            <Plus aria-hidden="true" />
            {t('consent.templates.new')}
          </Button>
        ) : null}
      </div>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {creating ? (
        <CreateTemplateCard
          onCancel={() => setCreating(false)}
          onCreated={async (created) => {
            setCreating(false);
            await load();
            setSelectedId(created.id);
          }}
        />
      ) : null}

      {templates.length === 0 && !creating ? (
        <Card>
          <EmptyState
            title={t('consent.templates.empty')}
            message={t('consent.templates.emptyHint')}
          />
        </Card>
      ) : null}

      <ul className="flex flex-col gap-2">
        {templates.map((template) => (
          <li key={template.id} className="overflow-hidden rounded-xl border bg-card">
            <button
              type="button"
              aria-expanded={selectedId === template.id}
              onClick={() => setSelectedId(selectedId === template.id ? null : template.id)}
              className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ChevronRight
                  aria-hidden="true"
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${selectedId === template.id ? 'rotate-90' : ''}`}
                />
                <span className="truncate font-medium">{template.name}</span>
                {template.archived ? (
                  <Badge variant="outline">{t('consent.templates.archived')}</Badge>
                ) : template.active === null ? (
                  <Badge variant="outline">{t('consent.templates.unpublished')}</Badge>
                ) : (
                  <Badge variant="secondary">
                    {t('consent.version')} {template.active.version}
                  </Badge>
                )}
              </span>
              <span className="pl-6 text-sm text-muted-foreground sm:pl-0">
                {template.validityDays === null
                  ? t('consent.templates.validityEvery')
                  : t('consent.templates.validityDays', { days: template.validityDays })}
              </span>
              <span className="truncate pl-6 text-sm text-muted-foreground sm:ml-auto sm:max-w-[40%] sm:pl-0">
                {template.serviceIds.length === 0
                  ? t('consent.templates.noServices')
                  : template.serviceIds
                      .map((id) => serviceNames.get(id))
                      .filter((name): name is string => name !== undefined)
                      .join(', ') || String(template.serviceIds.length)}
              </span>
            </button>
            {selected !== null && selected.id === template.id ? (
              <TemplateEditor
                template={selected}
                canManage={canManage}
                onChanged={async () => {
                  await load();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreateTemplateCard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (template: ConsentTemplate) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [validity, setValidity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<ConsentTemplate>('consent-templates', {
        name: name.trim(),
        validityDays: parseValidity(validity),
      });
      await onCreated(created);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t('consent.templates.new')}</CardTitle>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field
          label={t('consent.templates.name')}
          placeholder={t('consent.templates.namePlaceholder')}
          maxLength={CONSENT_LIMITS.templateName}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <ValidityField value={validity} disabled={busy} onChange={setValidity} />
      </div>
      <p className="text-xs text-muted-foreground">{t('consent.templates.validityHint')}</p>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          loading={busy}
          disabled={busy || name.trim() === '' || !validValidity(validity)}
          onClick={() => void submit()}
        >
          {t('consent.templates.create')}
        </Button>
      </div>
    </Card>
  );
}

function TemplateEditor({
  template,
  canManage,
  onChanged,
}: {
  template: ConsentTemplate;
  canManage: boolean;
  onChanged: () => Promise<void>;
}): ReactNode {
  const [draftBody, setDraftBody] = useState(template.draft?.body ?? template.active?.body ?? '');
  const [name, setName] = useState(template.name);
  const [validity, setValidity] = useState(
    template.validityDays === null ? '' : String(template.validityDays),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = draftBody.trim();
  const draftDirty = trimmed !== (template.draft?.body ?? '');
  const sameAsActive = template.draft === null && trimmed === (template.active?.body ?? '');
  const settingsDirty =
    name.trim() !== template.name || parseValidity(validity) !== template.validityDays;
  const editable = canManage && !template.archived;

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await action();
      await onChanged();
      toast.success(message);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 border-t px-4 py-4 sm:px-5">
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {editable ? (
        <section className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <Field
              label={t('consent.templates.name')}
              maxLength={CONSENT_LIMITS.templateName}
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
            <ValidityField value={validity} disabled={saving} onChange={setValidity} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{t('consent.templates.validityHint')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full shrink-0 sm:w-auto"
              disabled={saving || !settingsDirty || name.trim() === '' || !validValidity(validity)}
              onClick={() =>
                void run(
                  () =>
                    api.patch(`consent-templates/${template.id}`, {
                      name: name.trim(),
                      validityDays: parseValidity(validity),
                    }),
                  t('toast.saved'),
                )
              }
            >
              {t('consent.templates.saveSettings')}
            </Button>
          </div>
        </section>
      ) : null}

      {template.active !== null ? (
        <details className="group rounded-lg border bg-muted/30" open={!editable}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
            <ChevronRight
              aria-hidden="true"
              className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
            />
            {t('consent.active')} · {t('consent.version')} {template.active.version}
          </summary>
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t px-3 py-3 text-sm">
            {template.active.body}
          </p>
        </details>
      ) : null}

      {editable ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-label">{t('consent.templates.body')}</h3>
            {template.draft !== null ? <Badge variant="outline">{t('consent.draft')}</Badge> : null}
          </div>
          <Textarea
            value={draftBody}
            maxLength={CONSENT_LIMITS.body}
            rows={10}
            className="min-h-48 text-sm leading-relaxed"
            placeholder={t('consent.templates.bodyPlaceholder')}
            aria-label={t('consent.templates.body')}
            onChange={(event) => setDraftBody(event.target.value)}
          />
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <ConfirmButton
              variant="ghost"
              className="w-full text-muted-foreground sm:w-auto"
              title={t('consent.templates.archiveConfirmTitle')}
              description={t('consent.templates.archiveConfirmBody')}
              confirmLabel={t('consent.templates.archive')}
              disabled={saving}
              onConfirm={() =>
                void run(
                  () => api.post(`consent-templates/${template.id}/archive`, {}),
                  t('toast.saved'),
                )
              }
            >
              <Archive aria-hidden="true" />
              {t('consent.templates.archive')}
            </ConfirmButton>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                disabled={saving || trimmed === '' || !draftDirty || sameAsActive}
                onClick={() =>
                  void run(
                    () => api.put(`consent-templates/${template.id}/draft`, { body: trimmed }),
                    t('toast.saved'),
                  )
                }
              >
                {t('consent.saveDraft')}
              </Button>
              <ConfirmButton
                className="w-full sm:w-auto"
                title={t('consent.publishConfirmTitle')}
                description={t('consent.templates.publishConfirmBody')}
                confirmLabel={t('consent.publishConfirmAction')}
                disabled={
                  saving ||
                  trimmed === '' ||
                  sameAsActive ||
                  (template.draft === null && !draftDirty)
                }
                onConfirm={() =>
                  void run(async () => {
                    // Ekranda görünen metin ile yayınlanan metin aynı olmalı.
                    if (draftDirty) {
                      await api.put(`consent-templates/${template.id}/draft`, { body: trimmed });
                    }
                    await api.post(`consent-templates/${template.id}/publish`, {});
                  }, t('toast.saved'))
                }
              >
                {t('consent.publish')}
              </ConfirmButton>
            </div>
          </div>
        </section>
      ) : canManage && template.archived ? (
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto sm:self-start"
          disabled={saving}
          onClick={() =>
            void run(
              () => api.post(`consent-templates/${template.id}/restore`, {}),
              t('toast.saved'),
            )
          }
        >
          {t('consent.templates.restore')}
        </Button>
      ) : null}
    </div>
  );
}

function ValidityField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <Field
      label={t('consent.templates.validityLabel')}
      inputMode="numeric"
      value={value}
      disabled={disabled}
      // Geçersizken aynı açıklama HATA olarak gösteriliyor (1–3650 gün ya da boş).
      {...(validValidity(value) ? {} : { error: t('consent.templates.validityHint') })}
      onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
    />
  );
}

function parseValidity(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
}

function validValidity(value: string): boolean {
  const parsed = parseValidity(value);
  return (
    parsed === null ||
    (Number.isInteger(parsed) && parsed >= 1 && parsed <= CONSENT_LIMITS.validityDays)
  );
}
