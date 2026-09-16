'use client';

import type { ReactNode } from 'react';
import type { Branch, CarouselItemInput, ContentBlockInput, FaqItemInput } from '@klinara/shared';
import { BLOCK_FIELDS, type FieldSpec } from '@/lib/editor/block-schema';
import type { FieldError } from '@/lib/editor/validate';
import { Field, FieldSelect, FieldSwitch, FieldTextarea } from '@/components/ui/field';
import { AssetPicker } from './asset-picker';
import { CarouselItems } from './carousel-items';
import { CategoryPicker } from './category-picker';
import { FaqItems } from './faq-items';

/**
 * Seçili bloğun formu — ŞARTNAMEDEN üretiliyor.
 *
 * Blok türü başına elle yazılmış altı form yerine tek bir render döngüsü: yeni
 * bir blok türü eklendiğinde `block-schema.ts`e bir satır yetiyor ve sınırlar
 * `CONTENT_LIMITS`ten geldiği için forma elle kopyalanmıyor.
 */
export function BlockForm({
  block,
  index,
  branches,
  errors,
  readOnly,
  onChange,
}: {
  block: ContentBlockInput;
  index: number;
  branches: readonly Branch[];
  errors: readonly FieldError[];
  readOnly: boolean;
  onChange: (block: ContentBlockInput) => void;
}): ReactNode {
  const record = block as unknown as Record<string, unknown>;

  function set(key: string, value: unknown): void {
    // Boş dize `undefined`a çevriliyor: sunucu opsiyonel alanları
    // `@IsOptional()` ile eliyor ve boş dize göndermek bir `MaxLength` hatası
    // değil ama gereksiz bir alan yazımı olurdu.
    const next = { ...record, [key]: value === '' ? undefined : value };
    onChange(next as unknown as ContentBlockInput);
  }

  function errorFor(field: FieldSpec): string | undefined {
    return errors.find((error) => error.path === `sections[${String(index)}].${field.key}`)?.message;
  }

  return (
    <div className="flex flex-col gap-4">

      {BLOCK_FIELDS[block.type].map((field) => {
        const value = record[field.key];
        const error = errorFor(field);
        const label = String(field.labelKey);

        switch (field.kind) {
          case 'markdown':
          case 'textarea':
            return (
              <FieldTextarea
                key={field.key}
                label={label}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(field.key, event.target.value)}
                maxLength={field.max}
                rows={12}
                readOnly={readOnly}
                error={error}
                hint={
                  field.kind === 'markdown'
                    ? `**kalın**, - liste, [bağlantı](https://…) · ${String((typeof value === 'string' ? value : '').length)}/${String(field.max ?? '')}`
                    : undefined
                }
                className="font-mono text-sm"
              />
            );

          case 'boolean':
            return (
              <FieldSwitch
                key={field.key}
                label={label}
                checked={value !== false}
                disabled={readOnly}
                onCheckedChange={(checked) => set(field.key, checked)}
                className="rounded-lg border border-border px-3"
              />
            );

          case 'number':
            return (
              <Field
                key={field.key}
                label={label}
                type="number"
                value={typeof value === 'number' ? value : ''}
                min={field.min}
                max={field.max}
                readOnly={readOnly}
                error={error}
                onChange={(event) =>
                  set(field.key, event.target.value === '' ? undefined : Number(event.target.value))
                }
              />
            );

          case 'branch':
            return (
              <FieldSelect
                key={field.key}
                label={label}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(field.key, event.target.value)}
                disabled={readOnly}
              >
                <option value="">Tümü</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </FieldSelect>
            );

          case 'asset':
            return (
              <AssetPicker
                key={field.key}
                label={label}
                assetId={typeof value === 'string' ? value : null}
                readOnly={readOnly}
                onChange={(assetId) => set(field.key, assetId ?? undefined)}
              />
            );

          case 'assetList':
            return (
              <CarouselItems
                key={field.key}
                label={label}
                items={Array.isArray(value) ? (value as CarouselItemInput[]) : []}
                readOnly={readOnly}
                error={error}
                onChange={(items) => set(field.key, items)}
              />
            );

          case 'faqList':
            return (
              <FaqItems
                key={field.key}
                label={label}
                items={Array.isArray(value) ? (value as FaqItemInput[]) : []}
                readOnly={readOnly}
                error={error}
                onChange={(items) => set(field.key, items)}
              />
            );

          case 'uuidList':
            return (
              <CategoryPicker
                key={field.key}
                label={label}
                selected={Array.isArray(value) ? (value as string[]) : []}
                maxItems={field.maxItems ?? 0}
                readOnly={readOnly}
                error={error}
                onChange={(ids) => set(field.key, ids)}
              />
            );

          default:
            return (
              <Field
                key={field.key}
                label={label}
                value={typeof value === 'string' ? value : ''}
                maxLength={field.max}
                readOnly={readOnly}
                error={error}
                onChange={(event) => set(field.key, event.target.value)}
              />
            );
        }
      })}
    </div>
  );
}
