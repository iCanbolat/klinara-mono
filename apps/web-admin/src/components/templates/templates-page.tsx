'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type NotificationTemplate } from '@klinara/shared';
import { t, type MessageKey } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { can } from '@/lib/permissions';
import { toMessage } from '@/lib/reports/errors';
import { eventKeys, groupByEvent, templateKey, toggleInput } from '@/lib/templates/model';
import { useSession } from '@/components/session/session-provider';
import { Alert } from '@/components/ui/alert';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldSwitch } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { LocationCard } from './location-card';
import { TemplateText } from './template-text';

const CHANNEL_LABEL: Record<string, MessageKey> = {
  whatsapp: 'templates.channel.whatsapp',
  email: 'templates.channel.email',
  push: 'templates.channel.push',
};

/**
 * Mesaj şablonları — mobildeki "Bildirim şablonları" ekranının panel karşılığı.
 *
 * Müşteri yalnız mesajın GÖNDERİLİP GÖNDERİLMEYECEĞİNİ seçer; metin salt
 * okunur. WhatsApp'a giden mesaj Meta'da onaylı template'tir, buradaki gövde
 * kaydın kopyasıdır — düzenlenebilir görünmesi gönderimi değiştirdiği izlenimini
 * verirdi. Değişkenler `@HizmetAdı` gibi mavi alanlar olarak çizilir.
 */
export function TemplatesPage(): ReactNode {
  const { permissions } = useSession();
  const canManage = can(permissions, PERMISSIONS.NOTIFICATION_MANAGE);

  /** `undefined` = yükleniyor. */
  const [templates, setTemplates] = useState<NotificationTemplate[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await api.get<NotificationTemplate[]>('notification-templates'));
      setError(null);
    } catch (caught) {
      setError(toMessage(caught) ?? t('templates.error.load'));
      setTemplates((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function toggle(template: NotificationTemplate, isActive: boolean): Promise<void> {
    const key = templateKey(template);
    setBusyKey(key);
    try {
      const saved = await api.put<NotificationTemplate>(
        'notification-templates',
        toggleInput(template, isActive),
      );
      setTemplates((current) =>
        current?.map((item) => (templateKey(item) === templateKey(saved) ? saved : item)),
      );
      toast.success(t('templates.saved'));
    } catch (caught) {
      const message = toMessage(caught);
      if (message !== null) toast.error(message);
    } finally {
      setBusyKey(null);
    }
  }

  const groups = useMemo(() => groupByEvent(templates ?? []), [templates]);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('templates.title')} description={t('templates.description')} />
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <LocationCard />

      {templates === undefined ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : groups.length === 0 ? (
        error === null ? <EmptyState title={t('templates.empty')} /> : null
      ) : (
        groups.map((group) => {
          const keys = eventKeys(group.event);
          return (
            <Card key={group.event} data-event={group.event}>
              <CardHeader>
                <div>
                  <CardTitle>{keys === undefined ? group.event : t(keys.title)}</CardTitle>
                  {keys === undefined ? null : <CardDescription>{t(keys.help)}</CardDescription>}
                </div>
              </CardHeader>
              <div className="flex flex-col gap-5">
                {group.templates.map((template) => {
                  const key = templateKey(template);
                  const channel = CHANNEL_LABEL[template.channel];
                  return (
                    <section key={key} aria-label={channel === undefined ? template.channel : t(channel)}>
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span>{channel === undefined ? template.channel : t(channel)}</span>
                        {template.isActive ? null : (
                          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium">
                            {t('templates.off')}
                          </span>
                        )}
                      </div>
                      <p className="mb-1 text-xs text-muted-foreground">{t('templates.message')}</p>
                      <div className="rounded-lg border border-border bg-background p-3">
                        <TemplateText segments={template.segments} emptyLabel={t('templates.noText')} />
                      </div>
                      <FieldSwitch
                        className="mt-2"
                        label={t('templates.send')}
                        hint={t('templates.sendHint')}
                        checked={template.isActive}
                        disabled={!canManage || busyKey === key}
                        onCheckedChange={(next) => void toggle(template, next)}
                      />
                    </section>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
