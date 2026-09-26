'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type {
  ConversationMessage,
  ConversationTemplateOption,
  SendConversationTemplateInput,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { renderTemplate } from '@/lib/messages/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const VARIABLE_LABEL: Record<string, Parameters<typeof t>[0]> = {
  customerName: 'messages.template.var.customerName',
  branchName: 'messages.template.var.branchName',
  appointmentAt: 'messages.template.var.appointmentAt',
  serviceName: 'messages.template.var.serviceName',
  packageName: 'messages.template.var.packageName',
  remainingSessions: 'messages.template.var.remainingSessions',
  expiresAt: 'messages.template.var.expiresAt',
};

const keyOf = (option: ConversationTemplateOption): string => `${option.name}|${option.language}`;

/**
 * Pencere kapalıyken onaylı şablon gönderimi.
 *
 * Değişkenler sunucunun önerisiyle dolu gelir (müşteri adı, şube, en yakın
 * randevu); resepsiyon düzeltip önizlemede müşteriye gidecek metni görür.
 */
export function TemplateDialog({
  conversationId,
  open,
  onClose,
  onSend,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  onSend: (input: SendConversationTemplateInput) => Promise<ConversationMessage>;
}): ReactNode {
  const [options, setOptions] = useState<ConversationTemplateOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diyalog her açılışta yeniden kurulur (bkz. `Composer`); durum temiz başlar.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api
      .get<ConversationTemplateOption[]>(`conversations/${conversationId}/templates`, {
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setOptions(result);
        const first = result[0];
        setSelected(first === undefined ? '' : keyOf(first));
        setValues(first?.suggestedParameters ?? []);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLoadError(toMessage(caught));
      });
    return () => controller.abort();
  }, [open, conversationId]);

  const option = useMemo(
    () => options?.find((row) => keyOf(row) === selected),
    [options, selected],
  );
  const preview = option === undefined ? '' : renderTemplate(option.bodyText, values);
  const complete =
    option !== undefined &&
    values.length === option.bodyVariableCount &&
    values.every((value) => value.trim().length > 0);

  function choose(key: string): void {
    setSelected(key);
    setError(null);
    setValues(options?.find((row) => keyOf(row) === key)?.suggestedParameters ?? []);
  }

  async function submit(): Promise<void> {
    if (option === undefined) return;
    if (!complete) {
      setError(t('messages.template.missing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onSend({
        templateName: option.name,
        language: option.language,
        parameters: values.map((value) => value.trim()),
      });
      if (message.status === 'failed') {
        toast.error(t('messages.sendFailed', { reason: message.errorDetail ?? '' }));
      } else {
        toast.success(t('messages.template.sent'));
      }
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('messages.template.title')}</DialogTitle>
          <DialogDescription>{t('messages.template.description')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-4">
            {loadError !== null ? <Alert tone="danger">{loadError}</Alert> : null}
            {options === null && loadError === null ? (
              <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('messages.template.loading')}>
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : null}
            {options !== null && options.length === 0 ? (
              <Alert tone="warn">{t('messages.template.empty')}</Alert>
            ) : null}

            {options !== null && options.length > 0 ? (
              <>
                <FieldSelect
                  label={t('messages.template.label')}
                  value={selected}
                  disabled={busy}
                  onChange={(event) => choose(event.target.value)}
                >
                  {options.map((row) => (
                    <option key={keyOf(row)} value={keyOf(row)}>
                      {row.name}
                    </option>
                  ))}
                </FieldSelect>

                {option?.variableNames.map((name, index) => {
                  const labelKey = name === null ? undefined : VARIABLE_LABEL[name];
                  return (
                    <Field
                      // Şablon değişince alanlar sıfırdan kurulsun.
                      key={`${selected}-${index}`}
                      label={
                        labelKey !== undefined
                          ? t(labelKey)
                          : t('messages.template.parameter', { index: index + 1 })
                      }
                      value={values[index] ?? ''}
                      maxLength={1000}
                      disabled={busy}
                      onChange={(event) => {
                        const next = [...values];
                        next[index] = event.target.value;
                        setValues(next);
                      }}
                    />
                  );
                })}

                <div className="flex flex-col gap-1.5">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {t('messages.template.preview')}
                  </p>
                  <p
                    data-testid="template-preview"
                    className="rounded-2xl rounded-br-md border border-primary/20 bg-primary/10 px-3.5 py-2 text-sm whitespace-pre-wrap text-foreground"
                  >
                    {preview}
                  </p>
                </div>
              </>
            ) : null}

            {error !== null ? (
              <Alert tone="danger">
                <span role="alert">{error}</span>
              </Alert>
            ) : null}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('messages.template.cancel')}
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={option === undefined || busy}
            onClick={() => void submit()}
          >
            {t('messages.template.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
