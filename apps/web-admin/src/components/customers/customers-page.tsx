'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CUSTOMER_SOURCES, PERMISSIONS, type Customer, type CustomerTag } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { DataPage } from '@/components/data-page/data-page';
import { DataTable, type DataColumn } from '@/components/data-page/data-table';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { useCustomers } from './use-customers';
import { CustomerFormDialog } from './customer-form';
import { CustomerListCard } from './customer-list-card';

/**
 * Müşteri defteri.
 *
 * SERVER sayfalama: cursor'lı Önceki / Sonraki (bkz. `use-customers.ts`).
 *
 * Arama en az 2 karakter istiyor. Bunun altında arama ucu ÇAĞRILMIYOR:
 * sunucu 400 verir ve kullanıcı her harfte kırmızı bir satır görürdü.
 */

const COLUMNS: readonly DataColumn<Customer>[] = [
  {
    key: 'name',
    header: t('customers.name'),
    render: (customer) => (
      <>
        <Link
          href={`/musteriler/${customer.id}`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {customer.fullName}
        </Link>
        {customer.mergedIntoCustomerId !== null ? (
          <span className="ml-2 text-xs text-muted-foreground">{t('customers.inactive')}</span>
        ) : null}
      </>
    ),
  },
  {
    key: 'phone',
    header: t('customers.phone'),
    className: 'tabular-nums whitespace-nowrap',
    render: (customer) => customer.phone ?? '—',
  },
  {
    key: 'tags',
    header: t('customers.tags'),
    render: (customer) => customer.tags.map((tag) => tag.name).join(', ') || '—',
  },
];

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
        setTags(result.data ?? []);
      } catch {
        // Sessiz: etiketler yalnız bir süzgeç. Liste onlarsız da çalışıyor
        // ve ekrana kırmızı bir satır basmak görünen veriyle çelişirdi.
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <>
      <DataPage
        title={t('customers.title')}
        {...(canWrite
          ? {
              actions: (
                <Button type="button" onClick={() => setCreating(true)}>
                  {t('customers.new')}
                </Button>
              ),
            }
          : {})}
        filters={
          <>
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
          </>
        }
        rows={state.customers}
        rowKey={(customer) => customer.id}
        loading={state.loading}
        error={state.error}
        onRetry={state.reload}
        emptyTitle={t('customers.empty')}
        viewStorageKey="klinara.admin.view.customers"
        pagination={{
          mode: 'server',
          pageIndex: state.pageIndex,
          hasPrev: state.hasPrev,
          hasNext: state.hasNext,
          onPrev: state.prev,
          onNext: state.next,
        }}
        renderTable={(rows) => (
          <DataTable
            caption={t('customers.title')}
            columns={COLUMNS}
            rows={rows}
            rowKey={(customer) => customer.id}
          />
        )}
        renderCard={(customer) => <CustomerListCard customer={customer} />}
      />

      <CustomerFormDialog
        open={creating}
        customer={null}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          state.reload();
        }}
      />
    </>
  );
}
