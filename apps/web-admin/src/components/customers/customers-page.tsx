'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CUSTOMER_SOURCES, PERMISSIONS, type CustomerTag } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldSelect } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomers } from './use-customers';
import { CustomerFormDialog } from './customer-form';

/**
 * Müşteri defteri.
 *
 * Sayfalama cursor'lı ve "daha fazla" listeye EKLİYOR; offset sayfalama
 * olmadığı için "3. sayfaya git" diye bir şey yok (bkz. `use-customers.ts`).
 *
 * Arama en az 2 karakter istiyor. Bunun altında arama ucu ÇAĞRILMIYOR:
 * sunucu 400 verir ve kullanıcı her harfte kırmızı bir satır görürdü.
 */
export function CustomersPage(): ReactNode {
  const { permissions } = useSession();
  const [query, setQuery] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [creating, setCreating] = useState(false);

  const state = useCustomers({ query, tagId, source });
  const canWrite = permissions.includes(PERMISSIONS.CUSTOMER_WRITE);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await api.get<{ data: CustomerTag[] }>('customer-tags', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setTags(result.data);
      } catch {
        // Sessiz: etiketler yalnız bir süzgeç. Liste onlarsız da çalışıyor
        // ve ekrana kırmızı bir satır basmak görünen veriyle çelişirdi.
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('customers.title')}
        actions={
          canWrite ? (
            <Button type="button" onClick={() => setCreating(true)}>
              {t('customers.new')}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={t('customers.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <FieldSelect
          label={t('customers.allTags')}
          value={tagId ?? ''}
          onChange={(event) => setTagId(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('customers.allTags')}</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          label={t('customers.allSources')}
          value={source ?? ''}
          onChange={(event) => setSource(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('customers.allSources')}</option>
          {CUSTOMER_SOURCES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </FieldSelect>
      </div>

      {state.error !== null ? (
        <Alert tone="danger">
          <span role="alert">{state.error}</span>
        </Alert>
      ) : null}

      {state.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {!state.loading && state.customers.length === 0 && state.error === null ? (
        <EmptyState title={t('customers.empty')} />
      ) : null}

      {state.customers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('customers.title')}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('customers.name')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('customers.phone')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('customers.tags')}
                </th>
              </tr>
            </thead>
            <tbody>
              {state.customers.map((customer) => (
                <tr key={customer.id} className="border-b border-border/60">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/musteriler/${customer.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {customer.fullName}
                    </Link>
                    {customer.mergedIntoCustomerId !== null ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('customers.inactive')}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{customer.phone ?? '—'}</td>
                  <td className="py-2 pr-3">
                    {customer.tags.map((tag) => tag.name).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {state.hasMore ? (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          loading={state.loadingMore}
          onClick={state.loadMore}
        >
          {t('customers.loadMore')}
        </Button>
      ) : null}

      <CustomerFormDialog
        open={creating}
        customer={null}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          state.reload();
        }}
      />
    </div>
  );
}
