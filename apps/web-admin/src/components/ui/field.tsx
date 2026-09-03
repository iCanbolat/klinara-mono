'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
}

/**
 * Etiketli metin alanı.
 *
 * Hata metni `aria-describedby` ile alana BAĞLI ve `role="alert"` taşıyor:
 * ekran okuyucu kullanıcısı hatayı, alandan çıkmadan duyuyor. Yalnız kırmızı
 * kenarlıkla göstermek renk körü kullanıcılar için hiçbir şey ifade etmezdi.
 */
export function Field({ label, hint, error, className, ...props }: FieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
    .filter((value) => value !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          'h-10 rounded-md border bg-card px-3 text-sm text-ink',
          error === undefined ? 'border-line-strong' : 'border-danger',
          className,
        )}
        aria-invalid={error !== undefined}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
        {...props}
      />
      {hint !== undefined ? (
        <p id={hintId} className="text-xs text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
