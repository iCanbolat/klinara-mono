'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';

/*
 * Etiket + kontrol + ipucu + hata dörtlüsünün TEK yeri.
 *
 * Hata metni `aria-describedby` ile alana BAĞLI ve `role="alert"` taşıyor:
 * ekran okuyucu kullanıcısı hatayı, alandan çıkmadan duyuyor. Yalnız kırmızı
 * kenarlıkla göstermek renk körü kullanıcılar için hiçbir şey ifade etmezdi.
 *
 * Hata durumunda kenarlık `aria-invalid` üzerinden geliyor (bkz. `input.tsx`),
 * sınıf ternary'siyle değil — iOS'taki "hata, odaktan önce gelir" kuralı böylece
 * tek yerde tanımlı kalıyor.
 */
interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string;
}

interface Wiring {
  id: string;
  describedBy: Record<string, string>;
  invalid: boolean;
}

function useWiring(hint: ReactNode, error: string | undefined): Wiring {
  const id = useId();
  const ids = [
    error !== undefined ? `${id}-error` : null,
    hint !== undefined ? `${id}-hint` : null,
  ].filter((value) => value !== null);
  return {
    id,
    describedBy: ids.length === 0 ? {} : { 'aria-describedby': ids.join(' ') },
    invalid: error !== undefined,
  };
}

function Hint({ id, hint }: { id: string; hint: ReactNode }): ReactNode {
  return (
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">
      {hint}
    </p>
  );
}

function ErrorText({ id, error }: { id: string; error: string }): ReactNode {
  return (
    <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
      {error}
    </p>
  );
}

export type FieldProps = Omit<ComponentProps<'input'>, 'id'> & FieldShellProps;

export function Field({ label, hint, error, className, ...props }: FieldProps): ReactNode {
  const { id, describedBy, invalid } = useWiring(hint, error);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={cn(className)} aria-invalid={invalid} {...describedBy} {...props} />
      {hint !== undefined ? <Hint id={id} hint={hint} /> : null}
      {error !== undefined ? <ErrorText id={id} error={error} /> : null}
    </div>
  );
}

export type FieldTextareaProps = Omit<ComponentProps<'textarea'>, 'id'> & FieldShellProps;

export function FieldTextarea({
  label,
  hint,
  error,
  className,
  ...props
}: FieldTextareaProps): ReactNode {
  const { id, describedBy, invalid } = useWiring(hint, error);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        className={cn(className)}
        aria-invalid={invalid}
        {...describedBy}
        {...props}
      />
      {hint !== undefined ? <Hint id={id} hint={hint} /> : null}
      {error !== undefined ? <ErrorText id={id} error={error} /> : null}
    </div>
  );
}

/**
 * Yerel `<select>` BİLEREK korunuyor.
 *
 * Radix `Select` portal'da bir listbox çiziyor; klavye ve ekran okuyucu desteği
 * iyi ama mobil tarayıcının yerel seçici çarkını kaybettiriyor ve testleri
 * `user.selectOptions`tan koparıyor. Panelin filtreleri için kazancı yok.
 * Zengin içerikli (ikon, açıklama, arama) seçimler için `ui/select.tsx` var.
 */
export type FieldSelectProps = Omit<ComponentProps<'select'>, 'id'> & FieldShellProps;

export function FieldSelect({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: FieldSelectProps): ReactNode {
  const { id, describedBy, invalid } = useWiring(hint, error);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        aria-invalid={invalid}
        className={cn(
          'h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive',
          className,
        )}
        {...describedBy}
        {...props}
      >
        {children}
      </select>
      {hint !== undefined ? <Hint id={id} hint={hint} /> : null}
      {error !== undefined ? <ErrorText id={id} error={error} /> : null}
    </div>
  );
}

interface ToggleProps {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/**
 * iOS `KlinaraToggleRow` karşılığı: satırın TAMAMI etiket, dolayısıyla tıklama
 * hedefi. Anahtarın kendisi 44px'in altında ve tek başına zor bir hedef.
 */
export function FieldSwitch({
  label,
  hint,
  checked,
  disabled = false,
  onCheckedChange,
  className,
}: ToggleProps): ReactNode {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        {hint !== undefined ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function FieldCheckbox({
  label,
  hint,
  checked,
  disabled = false,
  onCheckedChange,
  className,
}: ToggleProps): ReactNode {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        {hint !== undefined ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}
