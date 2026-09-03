'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-sm font-medium', className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full border border-line-strong bg-card px-3 text-base outline-none',
        'transition-[border-color,box-shadow] duration-(--dur-fast)',
        'placeholder:opacity-40 focus:border-brand focus:ring-2 focus:ring-brand-ring',
        'disabled:opacity-60',
        className,
      )}
      style={{ borderRadius: 'var(--brand-radius)' }}
      {...props}
    />
  );
}

/** Etiket + alan + yardım/hata metnini tek yerde toplayan sarmalayıcı. */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint !== undefined && <p className="text-xs opacity-60">{hint}</p>}
    </div>
  );
}

export function Checkbox({
  id,
  checked,
  onCheckedChange,
  children,
  invalid,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children: ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-invalid={invalid ?? false}
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center border bg-card',
          'transition-colors duration-(--dur-fast) data-[state=checked]:border-brand data-[state=checked]:bg-brand',
          invalid === true ? 'border-red-600' : 'border-line-strong',
        )}
        style={{ borderRadius: 'calc(var(--brand-radius) / 3)' }}
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-4 animate-check-pop text-white" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <Label htmlFor={id} className="cursor-pointer text-sm leading-relaxed font-normal">
        {children}
      </Label>
    </div>
  );
}
